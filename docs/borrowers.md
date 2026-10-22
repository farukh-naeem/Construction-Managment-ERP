# Borrowers and linked loan ledgers

Borrower loans and repayments are canonical `BankTransaction` documents with
`borrowerId`. There is no duplicate borrower payment collection or stored
balance. Both ledger views read the same records. Outflows increase the amount
the borrower owes; inflows reduce it and may make the balance negative, meaning
the company owes the borrower. Historical transaction names survive borrower
renames.

Admin and Super Admin can create borrowers, edit names, and record payments.
Super Admin can delete payment entries or remove a borrower. Payments cannot be
edited: corrections use deletion and re-entry. Removing an empty borrower deletes
the record; removing a settled borrower with history archives it. Deleting an
archived borrower's repayment reactivates them if debt becomes outstanding.

## Integrity

All borrower financial mutations write the same borrower revision inside a
retryable MongoDB transaction. This serializes concurrent payments even when
different banks receive them. Archive/delete uses the same guard. Bank updates,
payment changes, borrower changes, and audit records commit together.

Amounts must be finite, positive, exactly representable in at most two decimal
places, and within safe integer minor-unit limits. Borrower balances may be
positive, zero, or negative. Bank debits must fit the current balance; deleting
a payment is blocked if its reversal would make the bank balance negative.
Existing non-borrower transaction paths retain their existing rules.

Bank account deletion also compares the original account timestamp and balances
at the final delete, preventing a loan committed after the linked-transaction
count check from losing its bank account.

## API additions

- `GET /api/borrowers?archived=false`: active borrowers with total loaned, total
  repaid, and outstanding. `archived=true` returns archived borrowers.
- `POST /api/borrowers`: `{ name }`.
- `PATCH /api/borrowers/:id`: `{ name }`; historical payments are not rewritten.
- `DELETE /api/borrowers/:id`: delete empty records, archive settled records,
  reject a nonzero balance.
- `GET /api/borrowers/:id/ledger`: includes totals and all bank payment rows.
  Optional `startDate` and `endDate` filter rows after running balances are computed.
- `POST /api/bank-transactions`: optional `borrowerId` with existing account,
  type, date, amount, mode, reference and remarks. Source/destination are derived
  server-side. Client, customer, project and custom-head attribution is rejected.
- `DELETE /api/bank-transactions/:id`: reverses a borrower payment atomically.
- `PATCH /api/bank-transactions/:id`: rejects borrower payments and attempts to
  assign `borrowerId` to an existing ordinary payment.

## Validation

From the repository root:

```sh
npm test
npm run build
npm --prefix backend run build
npm --prefix backend run test:borrowers
```

`test:borrowers` starts an ephemeral MongoDB replica set and local HTTP server.
It does not load `.env`, accept an external MongoDB URI, or connect to the ERP
database. It needs a supported Node runtime (20.19 or newer) and downloads a
MongoDB test binary on its first run.

## Staging and release order

1. Use the existing backup and staging process. Verify the target MongoDB
   supports transactions (replica set or sharded deployment).
2. Build and deploy the additive backend before the frontend. Keep existing
   collections, indexes and financial documents intact. No financial backfill,
   normalization, or recalculation is required.
3. Ensure the new borrower collection and indexes are ready before enabling the
   frontend. Use additive index creation, never `syncIndexes()` (which may remove
   existing indexes). The new schema declares a unique `normalizedName` index,
   an `archived/name` index, and a partial bank transaction index on
   `{ borrowerId: 1, date: 1, createdAt: 1, _id: 1 }` with
   `{ borrowerId: { $exists: true } }`. Index creation can scan the collection;
   schedule it using the existing production maintenance practice.
4. In staging, make payments from two banks, receive more than the balance owed,
   confirm the borrower balance turns negative, verify insufficient funds,
   delete through each ledger, archive a settled borrower,
   and verify reactivation after repayment deletion. Recheck a client payment,
   custom-head outflow, project funding, and customer-payment protection.
5. Deploy the frontend with its existing API configuration. Monitor rejected
   balance validations, transaction errors, and borrower audit records. Verify
   each changed bank's balance against its opening balance and ledger entries.

If a rollback is needed after borrower payments exist, roll back the frontend
while retaining the borrower-aware backend. An older backend would not enforce
borrower deletion and edit guards. Do not remove borrower records or loan
transactions as part of rollback.
