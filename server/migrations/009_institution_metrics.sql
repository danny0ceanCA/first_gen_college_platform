-- Aggregate counters only: no visitor IDs, IPs, URLs, profiles or event histories.
CREATE TABLE origen_institution_metrics (
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 month text NOT NULL CHECK (length(month)=7),
 metric text NOT NULL CHECK (metric IN ('page_view','link_click')),
 count bigint NOT NULL DEFAULT 0 CHECK (count >= 0),
 PRIMARY KEY (institution_id,month,metric)
);
