/**
 * Which D365 F&O OData entities the portal syncs, and how each field maps to a portal table column.
 * Field names were verified against the live environment's $metadata.
 * The same definitions drive the live OData sync and the snapshot loader, so both write identical rows.
 */
export type ColType = "text" | "date" | "num" | "int";
export type EnumName = "SalesStatus" | "SalesQuotationStatus" | "ReturnStatusHeader" | "LedgerTransType";

export interface EntityDef {
  entitySet: string;
  table: string;
  /** OData field -> [column, type] */
  map: Record<string, [string, ColType] | [string, ColType, EnumName]>;
  /** How a sync replaces rows: "full" = all rows of the company; "window" = rows with dateField >= from date. */
  mode: "full" | "window";
  dateField?: string;
  /** Extra OData $filter applied on every sync (e.g. only open order lines). */
  filter?: string;
  /** Table has no company column (global entity). */
  global?: boolean;
}

export const ENTITIES: EntityDef[] = [
  {
    entitySet: "CustomersV3", table: "d365.customers", mode: "full",
    map: {
      CustomerAccount: ["account", "text"], OrganizationName: ["name", "text"], CustomerGroupId: ["cust_group", "text"],
      CreditLimit: ["credit_limit", "num"], PaymentTerms: ["payment_terms", "text"], SalesCurrencyCode: ["currency", "text"],
      SalesDistrict: ["sales_district", "text"], SalesSegmentId: ["segment", "text"],
      EmployeeResponsibleNumber: ["responsible", "text"], AddressCity: ["city", "text"], AddressCountryRegionId: ["country", "text"],
    },
  },
  {
    entitySet: "EmployeesV2", table: "d365.workers", mode: "full", global: true,
    map: { PersonnelNumber: ["personnel_number", "text"], Name: ["name", "text"] },
  },
  {
    entitySet: "SalesInvoiceHeadersV4", table: "d365.invoice_headers", mode: "window", dateField: "InvoiceDate",
    map: {
      InvoiceNumber: ["invoice", "text"], InvoiceDate: ["invoice_date", "date"], InvoiceCustomerAccountNumber: ["customer", "text"],
      SalesOrderNumber: ["sales_order", "text"], SalesOrderResponsiblePersonnelNumber: ["responsible", "text"],
      CurrencyCode: ["currency", "text"], TotalInvoiceAmount: ["total_amount", "num"], TotalTaxAmount: ["tax_amount", "num"],
      TotalLineDiscount: ["line_discount", "num"], EndDiscount: ["end_discount", "num"], TotalChargeAmount: ["charges", "num"],
      PaymentTermsName: ["payment_terms", "text"], DeliveryModeCode: ["delivery_mode", "text"], LedgerVoucher: ["voucher", "text"],
    },
  },
  {
    entitySet: "SalesInvoiceV4Lines", table: "d365.invoice_lines", mode: "window", dateField: "InvoiceDate",
    map: {
      InvoiceNumber: ["invoice", "text"], InvoiceDate: ["invoice_date", "date"], LineCreationSequenceNumber: ["line_seq", "int"],
      ProductNumber: ["item", "text"], ProductName: ["item_name", "text"], SalesProductCategoryName: ["category", "text"],
      InvoicedQuantity: ["qty", "num"], SalesUnitSymbol: ["unit", "text"], SalesPrice: ["price", "num"],
      LineAmount: ["line_amount", "num"], LineTotalDiscountAmount: ["discount", "num"], LineTotalTaxAmount: ["tax", "num"],
      InventorySiteId: ["site", "text"], InventoryWarehouseId: ["warehouse", "text"], CurrencyCode: ["currency", "text"],
    },
  },
  {
    // Full history: needed for opening balances and statements. Open items = Closed is empty.
    entitySet: "CustTransactions", table: "d365.cust_trans", mode: "full",
    map: {
      SysRecId: ["rec_id", "int"], AccountNum: ["account", "text"], Voucher: ["voucher", "text"], Invoice: ["invoice", "text"],
      TransDate: ["trans_date", "date"], DueDate: ["due_date", "date"], DocumentDate: ["document_date", "date"],
      TransType: ["trans_type", "int", "LedgerTransType"], AmountMST: ["amount_mst", "num"], AmountCur: ["amount_cur", "num"],
      SettleAmountMST: ["settle_mst", "num"], CurrencyCode: ["currency", "text"], Closed: ["closed", "date"],
      LastSettleDate: ["last_settle_date", "date"], PaymMode: ["paym_mode", "text"], Txt: ["txt", "text"],
    },
  },
  {
    // Open order lines only (line status Backorder = 1). Replaced in full on every sync.
    entitySet: "SalesOrderLinesV3", table: "d365.order_lines", mode: "full",
    filter: "SalesOrderLineStatus eq Microsoft.Dynamics.DataEntities.SalesStatus'Backorder'",
    map: {
      SalesOrderNumber: ["sales_order", "text"], LineNumber: ["line_number", "num"], LineCreationSequenceNumber: ["line_seq", "int"],
      ItemNumber: ["item", "text"], LineDescription: ["description", "text"], OrderedSalesQuantity: ["qty", "num"],
      SalesUnitSymbol: ["unit", "text"], SalesPrice: ["price", "num"], LineDiscountAmount: ["discount_amount", "num"],
      LineDiscountPercentage: ["discount_pct", "num"], LineAmount: ["line_amount", "num"], CurrencyCode: ["currency", "text"],
      RequestedShippingDate: ["requested_ship", "date"], ConfirmedShippingDate: ["confirmed_ship", "date"],
      ShippingSiteId: ["site", "text"], ShippingWarehouseId: ["warehouse", "text"], SalesOrderLineStatus: ["status", "int", "SalesStatus"],
      CommissionSalesRepresentativeGroupId: ["sales_group", "text"], DeliveryModeCode: ["delivery_mode", "text"],
    },
  },
  {
    // Headers of open orders (status Backorder = 1).
    entitySet: "SalesOrderHeadersV4", table: "d365.order_headers", mode: "full",
    filter: "SalesOrderStatus eq Microsoft.Dynamics.DataEntities.SalesStatus'Backorder'",
    map: {
      SalesOrderNumber: ["sales_order", "text"], OrderingCustomerAccountNumber: ["customer", "text"],
      InvoiceCustomerAccountNumber: ["invoice_account", "text"], SalesOrderStatus: ["status", "int", "SalesStatus"],
      OrderCreationDateTime: ["created", "date"], RequestedShippingDate: ["requested_ship", "date"],
      ConfirmedShippingDate: ["confirmed_ship", "date"], OrderResponsiblePersonnelNumber: ["responsible", "text"],
      CurrencyCode: ["currency", "text"], DeliveryModeCode: ["delivery_mode", "text"],
      CustomerRequisitionNumber: ["customer_ref", "text"], SalesOrderName: ["name", "text"],
    },
  },
  {
    entitySet: "InventorySitesOnHandV2", table: "d365.onhand", mode: "full",
    map: {
      ItemNumber: ["item", "text"], InventorySiteId: ["site", "text"], AvailableOnHandQuantity: ["available", "num"],
      OnHandQuantity: ["physical", "num"], ReservedOnHandQuantity: ["reserved", "num"],
    },
  },
  {
    entitySet: "SalesQuotationHeadersV2", table: "d365.quotations", mode: "full",
    map: {
      SalesQuotationNumber: ["quotation", "text"], RequestingCustomerAccountNumber: ["customer", "text"], ProspectId: ["prospect", "text"],
      SalesQuotationName: ["name", "text"], SalesQuotationStatus: ["status", "int", "SalesQuotationStatus"], SalesQuotationExpiryDate: ["expiry", "date"],
      SalesQuotationConfirmationDate: ["confirmed", "date"], SalesQuotationFollowUpDate: ["follow_up", "date"],
      QuotationResponsiblePersonnelNumber: ["responsible", "text"], GeneratedSalesOrderNumber: ["sales_order", "text"],
      QuotationTotalAmount: ["total_amount", "num"], QuotationTotalDiscountAmount: ["discount_amount", "num"],
      CurrencyCode: ["currency", "text"], QuotationReasonCode: ["reason", "text"], RequestedShippingDate: ["requested_date", "date"],
    },
  },
  {
    entitySet: "SalesQuotationLines", table: "d365.quotation_lines", mode: "full",
    map: {
      SalesQuotationNumber: ["quotation", "text"], LineCreationSequenceNumber: ["line_seq", "int"], ItemNumber: ["item", "text"],
      RequestedSalesQuantity: ["qty", "num"], SalesPrice: ["price", "num"], LineAmount: ["line_amount", "num"],
    },
  },
  {
    entitySet: "ReturnOrderHeadersV2", table: "d365.return_headers", mode: "full",
    map: {
      ReturnOrderNumber: ["return_order", "text"], RMANumber: ["rma", "text"], CustomerAccountNumber: ["customer", "text"],
      InvoiceCustomerAccountNumber: ["invoice_account", "text"], CustomerReturnReasonCode: ["reason", "text"],
      ReturnStatus: ["return_status", "int", "ReturnStatusHeader"], ReturnOrderStatus: ["order_status", "int", "SalesStatus"], ReturnDeadline: ["deadline", "date"],
      ReplacementSalesOrderNumber: ["replacement_order", "text"], OrderTotalAmount: ["total_amount", "num"],
      CurrencyCode: ["currency", "text"], DefaultReturnWarehouseId: ["warehouse", "text"],
    },
  },
  {
    entitySet: "ReturnOrderLinesV2", table: "d365.return_lines", mode: "full",
    map: {
      ReturnOrderNumber: ["return_order", "text"], LineNumber: ["line_number", "num"], LineCreationSequenceNumber: ["line_seq", "int"],
      ItemNumber: ["item", "text"], ReturnSalesQuantity: ["return_qty", "num"], ReturnedSalesQuantity: ["returned_qty", "num"],
      SalesPrice: ["price", "num"], LineAmount: ["line_amount", "num"], ReturnDispositionCode: ["disposition", "text"],
      ReturnStatus: ["status", "int", "ReturnStatusHeader"], ExpectedReturnArrivalDate: ["expected_arrival", "date"],
      ActualReturnArrivalDate: ["actual_arrival", "date"], ReturnClosedDate: ["closed", "date"],
    },
  },
];

/** Convert one OData / snapshot value to a DB value. D365's empty date is 1900-01-01. */
export function convert(value: unknown, type: ColType, enumName?: EnumName): string | number | null {
  if (value === null || value === undefined) return type === "num" || type === "int" ? 0 : null;
  if (type === "date") {
    const s = String(value).slice(0, 10);
    if (!s || s.startsWith("1900-01-01")) return null;
    return s;
  }
  if (type === "num") return Number(value) || 0;
  if (type === "int") {
    if (typeof value === "number") return value;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    // OData returns enums by name ("Backorder"); snapshots carry the numeric value.
    return (enumName && ENUMS[enumName][String(value)]) ?? 0;
  }
  return String(value).replace(/\r?\n/g, " ").trim();
}

/** Enum values verified against the environment's $metadata. */
export const ENUMS: Record<EnumName, Record<string, number>> = {
  SalesStatus: { None: 0, Backorder: 1, Delivered: 2, Invoiced: 3, Canceled: 4 },
  SalesQuotationStatus: { Created: 0, Sent: 1, Confirmed: 2, Lost: 3, Cancelled: 4, Reset: 5, Modified: 6, Submitted: 7, Approved: 8, Revised: 9 },
  ReturnStatusHeader: { None: 0, Created: 1, Open: 2, Closed: 3, Canceled: 4 },
  LedgerTransType: {
    None: 0, Transfer: 1, Sales: 2, Purch: 3, Invent: 4, Production: 5, Project: 6, Interest: 7, Cust: 8, ExchAdjustment: 9,
    CollectionLetter: 13, Vend: 14, Payment: 15, Tax: 16, Bank: 17, BillOfExchange: 19, PromissoryNote: 20, Fee: 23,
    Settlement: 24, CashDiscount: 27, OverUnder: 28, PennyDifference: 29, WriteOff: 35, GeneralJournal: 36, SalesPrepayment: 251,
  },
};

export const TRANS_TYPE_LABEL: Record<number, string> = {
  2: "Sales invoice", 6: "Project invoice", 8: "Free text invoice", 13: "Collection letter", 15: "Payment",
  27: "Cash discount", 35: "Write-off", 36: "General journal",
};
export const QUOTE_STATUS: Record<number, string> = {
  0: "Created", 1: "Sent", 2: "Confirmed", 3: "Lost", 4: "Cancelled", 5: "Reset", 6: "Modified", 7: "Submitted", 8: "Approved", 9: "Revised",
};
export const RETURN_STATUS: Record<number, string> = { 0: "None", 1: "Created", 2: "Open", 3: "Closed", 4: "Canceled" };
