-- Canonicalize only the known project demo identities. Preserve credentials,
-- customer IDs, legal ownership and financial history; never replace a user
-- who already owns a destination email address.
DO $$
DECLARE
  identity_record RECORD;
  operator_id BIGINT;
BEGIN
  FOR identity_record IN SELECT * FROM (VALUES
    ('alex@evergreen.demo','alex@greenlink.demo','Alex Morgan','1020001001'),
    ('jamie@evergreen.demo','jamie@greenlink.demo','Jamie Lee','1020002001'),
    ('reviewer@evergreen.demo','reviewer@greenlink.demo','Sam Rivera','1020009001')
  ) AS identities(old_email,new_email,demo_name,account_number)
  LOOP
    SELECT u.id INTO operator_id FROM users u
      WHERE lower(u.email)=identity_record.old_email AND u.name=identity_record.demo_name
        AND EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=u.id
          AND a.number=identity_record.account_number
          AND a.opening_provenance IN ('legacy_verified','seed'))
      FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM users WHERE lower(email)=identity_record.new_email) THEN
      RAISE EXCEPTION 'Demo identity destination is already registered; review the account before migrating'
        USING ERRCODE='23505';
    END IF;
    UPDATE users SET email=identity_record.new_email,auth_version=auth_version+1 WHERE id=operator_id;
    UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=operator_id;
    INSERT INTO audit_log(target_user_id,event_type,metadata)
      VALUES(operator_id,'operator.demo_identity_renamed',jsonb_build_object(
        'previousEmail',identity_record.old_email,'email',identity_record.new_email,
        'reason','Project brand cleanup; existing password and financial records retained'));
  END LOOP;
END $$;
