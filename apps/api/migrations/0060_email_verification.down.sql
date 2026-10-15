alter table users
    drop column email_verified_at,
    drop column email_verification_sent_at,
    drop column email_verification_code;
