import { describe, expect, test } from "vitest";
import { buildContractPdf, contractFileName, type ContractDocumentData } from "./contract-pdf";

const baseData: ContractDocumentData = {
  company: {
    legal_name: "PT Arkiv Kuliner Nusantara",
    address: "Jl. Merdeka No. 1, Bandung",
    city: "Bandung",
    signer_name: "Ilham Kurniawan",
    signer_title: "Direktur",
  },
  employee: {
    full_name: "Budi Santoso",
    ktp: "3273012345678901",
    address: "Jl. Melati No. 5, Bandung",
    birth_date: "2000-03-12",
    phone: "0812345678",
  },
  contract: {
    contract_number: "0001/PKWT/VII/2026",
    contract_type: "pkwt",
    start_date: "2026-08-01",
    end_date: "2027-08-01",
    probation_end_date: null,
    position_title: "Kasir",
    department_name: "Operasional",
    work_location: "Outlet Sulu Bandung",
    base_salary: 4_500_000,
    signed_at: "2026-07-20",
  },
};

describe("buildContractPdf", () => {
  test("menghasilkan PDF valid untuk PKWT", async () => {
    const pdf = await buildContractPdf(baseData);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("menghasilkan PDF valid untuk PKWTT dengan masa percobaan", async () => {
    const pkwtt: ContractDocumentData = {
      ...baseData,
      contract: {
        ...baseData.contract,
        contract_number: "0002/PKWTT/VII/2026",
        contract_type: "pkwtt",
        end_date: null,
        probation_end_date: "2026-11-01",
      },
    };
    const pdf = await buildContractPdf(pkwtt);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("tidak crash saat data perusahaan/karyawan kosong (placeholder)", async () => {
    const sparse: ContractDocumentData = {
      company: {
        legal_name: null,
        address: null,
        city: null,
        signer_name: null,
        signer_title: null,
      },
      employee: {
        full_name: "Budi Santoso",
        ktp: null,
        address: null,
        birth_date: null,
        phone: null,
      },
      contract: {
        ...baseData.contract,
        base_salary: null,
        work_location: null,
        department_name: null,
        position_title: null,
        signed_at: null,
      },
    };
    const pdf = await buildContractPdf(sparse);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("contractFileName", () => {
  test("slug dari nomor kontrak + nama karyawan", () => {
    expect(contractFileName("0001/PKWT/VII/2026", "Budi Santoso")).toBe(
      "kontrak-0001-pkwt-vii-2026-budi-santoso.pdf"
    );
  });
});
