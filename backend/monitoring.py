"""Cloud Monitoring queries for A1 (% queries >200K context) and A2 (avg QPS).

Both queries hit the `aiplatform.googleapis.com/PublisherModel` resource type
and filter by `resource.model_user_id`.

We pull each metric ALIGNED at 5-minute deltas (one count per 5-min bucket)
rather than one summed value over the window. That lets us filter buckets by
day-of-week and hour-of-day in the user's local timezone — a peak-hours
workload (e.g. MWF 8:00–22:00 PT) shouldn't be averaged across nights and
weekends.

Per filtered window we report both the *average* count (sum / matched seconds)
and the *peak* (max single-bucket count) so the user can choose how aggressively
to size.

A2 — QPS  → avg = total_matched_requests / matched_seconds
        → peak = max_bucket_requests / 300

A1 — % requests with >=200K input tokens
        → avg = matched_requests_over_200k / matched_total_requests
        → peak = max bucket-level pct observed in any matched bucket
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from google.cloud import monitoring_v3


BUCKET_SECONDS = 300  # 5-minute alignment

# Bucket label format: INPUT_TOKEN_BUCKETIZED_SIZE_<LOW>_TO_<HIGH>
# Lower bounds we observe: 0, 100, 200, 300, 500, 1K, 2K, 5K, 10K, 20K,
# 30K, 40K, 50K, 75K, 100K, 150K, 200K, 300K, 500K, 1M, ...
_BUCKET_RE = re.compile(
    r"^INPUT_TOKEN_BUCKETIZED_SIZE_(?P<low>[0-9]+[KM]?)_TO_(?P<high>[0-9]+[KM]?)$"
)


def _parse_bound(token: str) -> int:
    """Parse '200K' / '1M' / '500' into an int."""
    if token.endswith("K"):
        return int(token[:-1]) * 1_000
    if token.endswith("M"):
        return int(token[:-1]) * 1_000_000
    return int(token)


def _bucket_lower_bound(bucket: str) -> int | None:
    m = _BUCKET_RE.match(bucket)
    if not m:
        return None
    return _parse_bound(m.group("low"))


# ── Time-of-day filter ──────────────────────────────────────────────────────


@dataclass
class TimeFilter:
    """Restrict aggregation to specific weekdays + an hour range, in `timezone`.

    - `days_of_week`: ints 0..6 (Mon=0…Sun=6). Empty/None = all 7 days.
    - `hour_start`/`hour_end`: 0..24, end is exclusive. Equal values = "all".
    - `hour_end < hour_start` wraps midnight (e.g. 22..6 = night shift).
    """
    days_of_week: set[int] | None = None
    hour_start: int = 0
    hour_end: int = 24
    timezone: str = "UTC"

    @property
    def is_active(self) -> bool:
        days_filtered = bool(self.days_of_week) and len(self.days_of_week) < 7
        hours_filtered = (
            self.hour_start != self.hour_end
            and not (self.hour_start == 0 and self.hour_end == 24)
        )
        return days_filtered or hours_filtered

    @property
    def tzinfo(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as e:
            raise ValueError(f"Unknown IANA timezone: {self.timezone!r}") from e

    def matches(self, ts: datetime) -> bool:
        local = ts.astimezone(self.tzinfo)
        if self.days_of_week and local.weekday() not in self.days_of_week:
            return False
        if self.hour_start == self.hour_end:
            return True  # treat as "all hours"
        h = local.hour
        if self.hour_start < self.hour_end:
            return self.hour_start <= h < self.hour_end
        # Wraps midnight: e.g. 22..6 means [22..24) ∪ [0..6)
        return h >= self.hour_start or h < self.hour_end


# ── MQL builders ────────────────────────────────────────────────────────────


def _mql_request_count(model: str, window_days: int) -> str:
    """Per-5-minute request counts over the window."""
    return (
        f"fetch aiplatform.googleapis.com/PublisherModel\n"
        f"| metric 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count'\n"
        f"| filter resource.model_user_id = '{model}'\n"
        f"| align delta(5m)\n"
        f"| within {window_days}d\n"
        f"| group_by [], [.sum]\n"
    )


def _mql_input_token_distribution(model: str, window_days: int) -> str:
    """Per-5-minute request counts, broken out by input-token bucket."""
    return (
        f"fetch aiplatform.googleapis.com/PublisherModel\n"
        f"| metric 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count'\n"
        f"| filter resource.model_user_id = '{model}'\n"
        f"| align delta(5m)\n"
        f"| within {window_days}d\n"
        f"| group_by [metric.input_token_size], [.sum]\n"
    )


# ── Helpers ─────────────────────────────────────────────────────────────────


def _client() -> monitoring_v3.QueryServiceClient:
    return monitoring_v3.QueryServiceClient()


def _label_strings(ts) -> list[str]:
    out: list[str] = []
    for v in ts.label_values:
        if v.string_value:
            out.append(v.string_value)
        elif v.int64_value:
            out.append(str(v.int64_value))
        else:
            out.append("")
    return out


def _point_value(p) -> float:
    """Sum the numeric values on a TimeSeriesData.point_data entry."""
    total = 0.0
    for v in p.values:
        if v.double_value:
            total += v.double_value
        elif v.int64_value:
            total += v.int64_value
    return total


def _point_endtime(p) -> datetime:
    """Return the bucket end-time as an aware UTC datetime.

    google-cloud-monitoring (proto-plus) returns time_interval.end_time as a
    proto.datetime_helpers.DatetimeWithNanoseconds — already a datetime
    subclass. Older raw-protobuf paths return google.protobuf.Timestamp with
    .ToDatetime(). Handle both, and ensure tzinfo is attached.
    """
    raw = p.time_interval.end_time
    dt = raw if isinstance(raw, datetime) else raw.ToDatetime()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt


def _walk_points(time_series_iter: Iterable) -> Iterable[tuple[list[str], datetime, float]]:
    """Yield (label_strings, bucket_end_ts_utc, value) for each point in each series."""
    for ts in time_series_iter:
        labels = _label_strings(ts)
        for p in ts.point_data:
            yield labels, _point_endtime(p), _point_value(p)


# ── Aggregation ─────────────────────────────────────────────────────────────


@dataclass
class _Agg:
    matched_count: float = 0.0          # sum of values across matching buckets
    matched_buckets: int = 0            # number of matching buckets (any value)
    total_buckets: int = 0              # total buckets seen (for diagnostics)
    peak_count: float = 0.0
    peak_ts_utc: datetime | None = None

    def add(self, when_utc: datetime, value: float, matched: bool) -> None:
        self.total_buckets += 1
        if not matched:
            return
        self.matched_buckets += 1
        self.matched_count += value
        if value > self.peak_count:
            self.peak_count = value
            self.peak_ts_utc = when_utc


def _aggregate_count_series(time_series_iter, tf: TimeFilter) -> _Agg:
    """Walk single-series points → matched sum, peak, bucket counts."""
    agg = _Agg()
    for _labels, when_utc, value in _walk_points(time_series_iter):
        agg.add(when_utc, value, tf.matches(when_utc))
    return agg


def _aggregate_distribution_series(
    time_series_iter, tf: TimeFilter
) -> tuple[_Agg, _Agg, dict[str, float]]:
    """Walk multi-bucket distribution → (totals_agg, over_200k_agg, per-bucket-totals).

    For peak %, we need to align all per-bucket series by timestamp and compute
    pct per bucket. Build a per-timestamp tally first, then walk timestamps.
    """
    # tally: ts_utc → {"total": float, "over": float, "matched": bool}
    tally: dict[datetime, dict[str, float | bool]] = {}
    bucket_totals: dict[str, float] = {}

    for labels, when_utc, value in _walk_points(time_series_iter):
        bucket_label = labels[0] if labels else ""
        bucket_totals[bucket_label] = bucket_totals.get(bucket_label, 0.0) + value
        slot = tally.setdefault(
            when_utc,
            {"total": 0.0, "over": 0.0, "matched": tf.matches(when_utc)},
        )
        slot["total"] += value
        low = _bucket_lower_bound(bucket_label)
        if low is not None and low >= 200_000:
            slot["over"] += value

    totals = _Agg()
    over = _Agg()
    peak_pct = 0.0
    peak_pct_ts: datetime | None = None

    for when_utc, slot in tally.items():
        matched = bool(slot["matched"])
        totals.add(when_utc, float(slot["total"]), matched)
        over.add(when_utc, float(slot["over"]), matched)
        if matched and slot["total"] > 0:
            pct = float(slot["over"]) / float(slot["total"]) * 100.0
            if pct > peak_pct:
                peak_pct = pct
                peak_pct_ts = when_utc

    # Stash the peak-pct meta on the `over` agg for the caller (cheap channel).
    over.peak_count = peak_pct
    over.peak_ts_utc = peak_pct_ts
    return totals, over, bucket_totals


# ── Public API ──────────────────────────────────────────────────────────────


def _to_local_iso(ts: datetime | None, tz_name: str) -> str | None:
    if ts is None:
        return None
    return ts.astimezone(ZoneInfo(tz_name)).isoformat(timespec="minutes")


def query_historical(
    project_id: str,
    model: str,
    window_days: int,
    *,
    days_of_week: list[int] | None = None,
    hour_start: int = 0,
    hour_end: int = 24,
    timezone: str = "UTC",
) -> dict[str, Any]:
    """Run both monitoring queries and return derived A1/A2 (avg + peak) plus diagnostics."""
    tf = TimeFilter(
        days_of_week=set(days_of_week) if days_of_week else None,
        hour_start=hour_start,
        hour_end=hour_end,
        timezone=timezone,
    )
    # Validate TZ early — raises ValueError on unknown.
    _ = tf.tzinfo

    client = _client()
    project_name = f"projects/{project_id}"

    count_mql = _mql_request_count(model, window_days)
    dist_mql = _mql_input_token_distribution(model, window_days)

    # A2: count series → avg QPS over matched buckets + peak QPS.
    a2 = _aggregate_count_series(
        client.query_time_series(
            request=monitoring_v3.QueryTimeSeriesRequest(name=project_name, query=count_mql)
        ),
        tf,
    )
    matched_seconds = a2.matched_buckets * BUCKET_SECONDS
    qps_avg = (a2.matched_count / matched_seconds) if matched_seconds else 0.0
    qps_peak = a2.peak_count / BUCKET_SECONDS

    # A1: distribution → per-bucket totals + matched-period over-200k tally.
    totals, over, per_bucket = _aggregate_distribution_series(
        client.query_time_series(
            request=monitoring_v3.QueryTimeSeriesRequest(name=project_name, query=dist_mql)
        ),
        tf,
    )
    a1_avg = (
        (over.matched_count / totals.matched_count * 100.0)
        if totals.matched_count > 0
        else 0.0
    )
    a1_peak = over.peak_count  # stashed by _aggregate_distribution_series

    return {
        "project_id": project_id,
        "model": model,
        "window_days": window_days,
        # Avg values (used by the existing copy paths)
        "a1_pct_over_200k": round(a1_avg, 4),
        "a2_qps": round(qps_avg, 6),
        # Peak values (new — shown side-by-side for reference)
        "a1_pct_peak": round(a1_peak, 4),
        "a2_qps_peak": round(qps_peak, 6),
        "filter_applied": {
            "active": tf.is_active,
            "days_of_week": sorted(tf.days_of_week) if tf.days_of_week else list(range(7)),
            "hour_start": tf.hour_start,
            "hour_end": tf.hour_end,
            "timezone": tf.timezone,
        },
        "diagnostics": {
            "total_requests": totals.matched_count,
            "requests_over_200k": over.matched_count,
            "qps_query_total_requests": a2.matched_count,
            "matched_buckets": a2.matched_buckets,
            "total_buckets": a2.total_buckets,
            "matched_seconds": matched_seconds,
            "peak_bucket_ts_qps": _to_local_iso(a2.peak_ts_utc, tf.timezone),
            "peak_bucket_ts_pct": _to_local_iso(over.peak_ts_utc, tf.timezone),
            "buckets": per_bucket,
        },
        "queries": {
            "a1": dist_mql,
            "a2": count_mql,
        },
    }
