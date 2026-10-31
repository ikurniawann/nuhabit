// Halaman dokumen quotation hidup di bawah menu pipeline agar ikut izin menunya.
export const PIPELINE_PATH = "/dashboard/sales-funnel/pipeline";

/** Pipeline dengan dialog deal terbuka (?deal=). */
export const dealPath = (dealId: string) => (dealId ? `${PIPELINE_PATH}?deal=${dealId}` : PIPELINE_PATH);

export const newQuotationPath = (dealId: string) => `${PIPELINE_PATH}/quotations/new?deal=${dealId}`;

export const quotationPath = (id: string) => `${PIPELINE_PATH}/quotations/${id}`;
