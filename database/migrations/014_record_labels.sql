-- Normalize legacy presentation labels on operator-provisioned records only.
-- Keep the original text in the audit trail; no financial fields are changed.
DO $$
DECLARE
  entry RECORD;
  replacement TEXT;
  revised_flags JSONB;
BEGIN
  FOR entry IN
    SELECT t.id,t.description,a.user_id
    FROM transactions t JOIN accounts a ON a.id=t.account_id
    WHERE a.opening_provenance='seed'
      AND (t.reference IN ('INDUSTRY-DEMO','DEMO-OPENING') OR t.reference LIKE 'SECTOR-DEMO-%')
      AND t.description ~ '^Fictional '
      AND EXISTS(SELECT 1 FROM audit_log l WHERE l.target_user_id=a.user_id
        AND ((l.event_type='operator.industry_demo_seeded' AND l.metadata->>'fixture'='gldb-industry-businesses-v1')
          OR (l.event_type='operator.sector_demo_seeded' AND l.metadata->>'fixture'='gldb-sector-portfolio-v1')))
    FOR UPDATE OF t
  LOOP
    replacement := CASE
      WHEN entry.description IN ('Fictional industry demonstration opening funds','Fictional demonstration opening funds') THEN 'Opening funds'
      WHEN entry.description='Fictional sector portfolio receipt' THEN 'Counterparty receipt'
      ELSE regexp_replace(entry.description,'^Fictional ','') END;
    UPDATE transactions SET description=replacement WHERE id=entry.id;
    INSERT INTO audit_log(target_user_id,event_type,metadata)
      VALUES(entry.user_id,'operator.record_label_updated',jsonb_build_object(
        'transactionId',entry.id,'previousDescription',entry.description,'description',replacement,
        'reason','Presentation wording update; financial values and settlement history retained'));
  END LOOP;

  FOR entry IN
    SELECT p.id,p.user_id,p.flags_json FROM demo_counterparties p
    WHERE p.fixture_key LIKE 'gldb-sector-portfolio-v1:%'
      AND p.flags_json::text LIKE '%Fictional scenario:%'
    FOR UPDATE
  LOOP
    SELECT jsonb_agg(jsonb_set(flag,'{description}',to_jsonb(
      replace(replace(replace(flag->>'description','Fictional scenario:','Operator-entered concern:'),
        'training sanctions alert','unverified sanctions-name alert'),
        'This is not a real sanctions listing.','This does not confirm a sanctions listing.'))) ORDER BY position)
      INTO revised_flags
      FROM jsonb_array_elements(entry.flags_json) WITH ORDINALITY AS inputs(flag,position);
    UPDATE demo_counterparties SET flags_json=revised_flags WHERE id=entry.id;
    INSERT INTO audit_log(target_user_id,event_type,metadata)
      VALUES(entry.user_id,'operator.company_case_labels_updated',jsonb_build_object(
        'profileId',entry.id,'previousFlags',entry.flags_json,'flags',revised_flags));
  END LOOP;

  FOR entry IN
    SELECT b.id,b.primary_user_id,b.registered_address FROM businesses b
    WHERE b.registered_address IN ('1 Fictional Industry Demo Avenue, Singapore 000001','1 Fictional Demo Lane, Singapore 000001')
      AND EXISTS(SELECT 1 FROM audit_log l WHERE l.target_user_id=b.primary_user_id
        AND l.event_type IN ('operator.industry_demo_seeded','operator.sector_demo_seeded')
        AND l.metadata->>'fixture' IN ('gldb-industry-businesses-v1','gldb-sector-portfolio-v1'))
    FOR UPDATE OF b
  LOOP
    UPDATE businesses SET registered_address='Address verification pending' WHERE id=entry.id;
    INSERT INTO audit_log(target_user_id,event_type,metadata)
      VALUES(entry.primary_user_id,'operator.address_label_updated',jsonb_build_object(
        'businessId',entry.id,'previousAddress',entry.registered_address,'address','Address verification pending'));
  END LOOP;
END $$;
