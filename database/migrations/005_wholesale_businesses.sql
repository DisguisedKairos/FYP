CREATE TABLE businesses (
  id BIGSERIAL PRIMARY KEY,
  primary_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
  legal_name TEXT NOT NULL CHECK(length(legal_name) BETWEEN 2 AND 160),
  registration_number TEXT NOT NULL UNIQUE CHECK(registration_number ~ '^[A-Z0-9][A-Z0-9-]{5,29}$'),
  country TEXT NOT NULL DEFAULT 'SG' CHECK(country='SG'),
  legal_form TEXT NOT NULL CHECK(legal_form IN ('company','partnership','institution')),
  industry TEXT NOT NULL CHECK(length(industry) BETWEEN 2 AND 100),
  registered_address TEXT NOT NULL CHECK(length(registered_address) BETWEEN 8 AND 300),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  review_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX businesses_review_queue ON businesses(status,created_at,id);
ALTER TABLE accounts ADD COLUMN business_id BIGINT REFERENCES businesses(id);
ALTER TABLE accounts ADD COLUMN product_type TEXT NOT NULL DEFAULT 'business_savings' CHECK(product_type='business_savings');
CREATE INDEX accounts_business ON accounts(business_id,id);

-- user_id is the sole authorized operator in this project version; business_id
-- is the legal account holder. Never permit a cross-business account binding.
CREATE FUNCTION enforce_business_account_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id BIGINT;
BEGIN
  IF NEW.business_id IS NULL THEN
    SELECT id INTO NEW.business_id FROM businesses WHERE primary_user_id=NEW.user_id;
  END IF;
  IF NEW.business_id IS NOT NULL THEN
    SELECT primary_user_id INTO owner_id FROM businesses WHERE id=NEW.business_id;
    IF owner_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Account operator does not belong to its business' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounts_business_owner BEFORE INSERT OR UPDATE OF user_id,business_id ON accounts
FOR EACH ROW EXECUTE FUNCTION enforce_business_account_owner();
