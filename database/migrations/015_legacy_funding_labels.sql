-- Complete the wording update for older operator-provisioned funding receipts.
-- Keep receipt references and financial data intact and audit the original text.
WITH originals AS MATERIALIZED (
  SELECT t.id,t.description,a.user_id FROM transactions t JOIN accounts a ON a.id=t.account_id
  WHERE t.description='Feature tour sample-funds deposit'
    AND t.reference='GLFT-SAMPLE-FUNDS' AND a.opening_provenance='seed'
    AND EXISTS(SELECT 1 FROM audit_log l
      WHERE l.event_type='operator.feature_accounts_created'
        AND l.metadata->>'fixture'='greenlink-feature-tour-v1'
        AND EXISTS(SELECT 1 FROM jsonb_each_text(l.metadata->'users') AS owners(label,value)
          WHERE owners.value=a.user_id::text))
  FOR UPDATE OF t
), changed AS (
  UPDATE transactions t SET description='Funding deposit' FROM originals o WHERE t.id=o.id RETURNING t.id
)
INSERT INTO audit_log(target_user_id,event_type,metadata)
SELECT o.user_id,'operator.record_label_updated',jsonb_build_object(
  'transactionId',o.id,'previousDescription',o.description,'description','Funding deposit',
  'reason','Legacy presentation wording update; reference and financial history retained')
FROM originals o JOIN changed c ON c.id=o.id;
