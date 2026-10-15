drop index if exists users_identity_fingerprint_hash_idx;
alter table users drop column identity_fingerprint_hash;

alter table account_suspensions drop constraint account_suspensions_reason_check;
alter table account_suspensions add constraint account_suspensions_reason_check
    check (reason in ('missed_ship_deadline', 'chargeback_fraud'));
