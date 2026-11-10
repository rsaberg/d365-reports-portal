/** Data-source footnote shared by the transaction tracking pages. */
export function OpsNote() {
  return (
    <p className="text-[12px] text-muted mt-4 max-w-3xl">
      Sources: D365 order and journal headers (sales, purchase, production and transfer orders; general, payment and inventory journals) and posted sales invoices.
      Journals without a posting date (general and payment journals) show no age. Who created a journal and vendor invoice/payment details need the custom
      D365 entities listed in the report plan.
    </p>
  );
}
