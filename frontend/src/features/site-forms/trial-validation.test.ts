import { describe, expect, test } from "vitest";
import { EMPTY_TRIAL, trialPayload, validateTrial, type TrialValues } from "./trial-validation";

const filled: TrialValues = {
  ...EMPTY_TRIAL,
  branch_slug: "kemang",
  first_name: "Ani",
  last_name: "Budi",
  email: "ani@example.test",
  phone_local: "0812 3456 7890",
  consent_email: true,
};

describe("validateTrial", () => {
  test("names every required field when the values are empty", () => {
    expect(validateTrial(EMPTY_TRIAL)).toEqual({
      branch_slug: "Choose a branch",
      first_name: "First name is required",
      email: "Email is required",
      phone_local: "Phone number is required",
    });
  });

  test("passes complete values without marketing consent", () => {
    expect(validateTrial(filled)).toEqual({});
    expect(validateTrial({ ...filled, consent_email: false, consent_sms: false })).toEqual({});
  });

  test("checks the shape of the email and the phone number", () => {
    expect(validateTrial({ ...filled, email: "bukan-email" }).email).toBe("Enter a valid email");
    expect(validateTrial({ ...filled, phone_local: "812" }).phone_local).toBe("Enter a valid phone number");
    expect(validateTrial({ ...filled, phone_country: "AU", phone_local: "0412 345 678" })).toEqual({});
  });

  test("caps names at 80 characters and allows an empty last name", () => {
    expect(validateTrial({ ...filled, last_name: "" })).toEqual({});
    expect(validateTrial({ ...filled, first_name: "a".repeat(81) }).first_name).toBe("First name is too long");
  });

  test("carries the E.164 number, UTM, source page and start timestamp in the payload", () => {
    expect(trialPayload(filled, { utm: { utm_source: "ig" }, source_path: "/locations/kemang", form_started_at: 123 })).toEqual({
      branch_slug: "kemang",
      first_name: "Ani",
      last_name: "Budi",
      email: "ani@example.test",
      phone: "+6281234567890",
      consent_email: true,
      consent_sms: false,
      utm: { utm_source: "ig" },
      source_path: "/locations/kemang",
      form_started_at: 123,
    });
  });
});
