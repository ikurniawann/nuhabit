import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage";
import { Resend } from "resend";
import { createPgClient } from "@/lib/pg/create-client";
import type { CandidateSource } from "@/types";
import { appOrigin } from "@/lib/app-origin";
import { checkRateLimit } from "@/lib/public/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import {
  candidateConfirmationHtml,
  emailSubject,
  hrdNotificationHtml,
  type ApplicationEmailData,
} from "./emails";

const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@aapextechnology.com";

/** Form karir publik: rem spam per IP (lihat model kepercayaan di client-ip). */
const SUBMIT_LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function getAdminDb() {
  return createPgClient();
}

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`portal-submit:${clientIp(request)}`, SUBMIT_LIMIT)) {
    return NextResponse.json(
      { error: "Terlalu banyak lamaran dari jaringan ini. Coba lagi beberapa menit lagi." },
      { status: 429 }
    );
  }
  try {
    const formData = await request.formData();

    const full_name = formData.get("full_name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const domicile = formData.get("domicile") as string;
    const source = formData.get("source") as string;
    const position_id = formData.get("position_id") as string | null;
    const brand_id = formData.get("brand_id") as string | null;
    const job_opening_id = formData.get("job_opening_id") as string | null;
    const notes = formData.get("notes") as string | null;
    // New fields
    const last_experience = formData.get("last_experience") as string | null;
    const last_education = formData.get("last_education") as string | null;
    const availability = formData.get("availability") as string | null;
    const expected_salary = formData.get("expected_salary") as string | null;

    const cvFile = formData.get("cv") as File | null;
    const photoFile = formData.get("photo") as File | null;

    // --- Basic validation ---
    if (!full_name || !email || !phone || !domicile || !source) {
      return NextResponse.json({ error: "Field wajib belum lengkap" }, { status: 400 });
    }
    if (!EMAIL_RE.test(email) || email.length > 255) {
      return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
    }

    // --- Photo is required ---
    if (!photoFile || photoFile.size === 0) {
      return NextResponse.json({ error: "Pas foto wajib diupload" }, { status: 400 });
    }

    // --- Upload files ---
    let cvUrl: string | null = null;
    let photoUrl: string | null = null;

    if (cvFile && cvFile.size > 0) {
      const validTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!validTypes.includes(cvFile.type)) {
        return NextResponse.json({ error: "CV harus format PDF atau DOC" }, { status: 400 });
      }
      if (cvFile.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "CV maksimal 2MB" }, { status: 400 });
      }
      const result = await uploadFile("cv", cvFile, "candidates");
      if (result.error) {
        return NextResponse.json({ error: "Gagal upload CV: " + result.error }, { status: 500 });
      }
      cvUrl = result.url;
    }

    if (photoFile && photoFile.size > 0) {
      const validTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!validTypes.includes(photoFile.type)) {
        return NextResponse.json({ error: "Foto harus format JPG/PNG" }, { status: 400 });
      }
      if (photoFile.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "Foto maksimal 2MB" }, { status: 400 });
      }
      const result = await uploadFile("photos", photoFile, "candidates");
      if (result.error) {
        return NextResponse.json({ error: "Gagal upload foto: " + result.error }, { status: 500 });
      }
      photoUrl = result.url;
    }

    // --- Save to database ---
    const adminDb = getAdminDb();

    // Get position and brand names for email
    let positionTitle = "Belum ditentukan";
    let brandName = "Umum";
    
    if (position_id) {
      const { data: pos } = await adminDb.from("positions").select("title").eq("id", position_id).single();
      if (pos) positionTitle = pos.title;
    }
    if (brand_id) {
      const { data: br } = await adminDb.from("brands").select("name").eq("id", brand_id).single();
      if (br) brandName = br.name;
    }

    const { data: candidate, error: insertError } = await adminDb
      .from("candidates")
      .insert({
        full_name,
        email,
        phone,
        domicile,
        source: source as CandidateSource,
        position_id: position_id || null,
        brand_id: brand_id || null,
        job_opening_id: job_opening_id || null,
        cv_url: cvUrl,
        photo_url: photoUrl,
        notes: notes || null,
        status: "applied",
        // New fields
        last_experience: last_experience || null,
        last_education: last_education || null,
        availability: availability || null,
        expected_salary: expected_salary ? parseInt(expected_salary, 10) : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Portal submit insert error:", insertError);
      return NextResponse.json({ error: "Gagal simpan lamaran" }, { status: 500 });
    }

    const emailData: ApplicationEmailData = {
      candidateId: candidate.id,
      fullName: full_name,
      email,
      phone,
      domicile,
      source,
      notes,
      positionTitle,
      brandName,
      origin: appOrigin(request),
    };

    // --- Send confirmation email to candidate ---
    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: "Lamaran Kamu Sudah Kami Terima",
          html: candidateConfirmationHtml(emailData),
        });
      } catch (emailError) {
        console.error("Candidate email error:", emailError);
      }
    }

    // --- Send notification email to HRD ---
    const HRD_EMAIL = process.env.HRD_EMAIL;
    if (process.env.RESEND_API_KEY && HRD_EMAIL) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: HRD_EMAIL,
          subject: emailSubject(`[Talent Pool] Lamaran Baru: ${full_name} untuk ${positionTitle}`),
          html: hrdNotificationHtml(emailData),
        });
      } catch (emailError) {
        console.error("HRD email error:", emailError);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Lamaran berhasil dikirim",
      candidate_id: candidate.id,
    });
  } catch (error: unknown) {
    console.error("Portal submit error:", error);
    return NextResponse.json({ error: "Terjadi kesalahan, coba lagi" }, { status: 500 });
  }
}
