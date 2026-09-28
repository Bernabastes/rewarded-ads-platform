import { Injectable, Logger } from '@nestjs/common';
import type { KycIdType } from '@prisma/client';
import { AppConfig } from '../../config/app-config';

export interface IdVerificationInput {
  idType: KycIdType;
  idNumber: string;
  fullName: string;
  dateOfBirth: Date;
}

export interface IdVerificationResult {
  provider: string;
  mock: boolean;
  /** Whether the registry confirmed the id number exists. */
  found: boolean;
  /** Name / DOB match against the registry record (0-1). */
  score: number;
  match: { fullName: boolean; dateOfBirth: boolean };
  raw?: unknown;
}

/**
 * Identity registry abstraction. Fayda (Ethiopia's national digital ID, NIDP) exposes an eKYC/authentication API
 * for onboarded relying parties; until credentials exist this build ships a documented MOCK. Admins still make the
 * final decision - the provider result is a pre-check shown in the KYC queue.
 */
export interface IdVerificationProvider {
  readonly name: string;
  readonly isMock: boolean;
  verify(input: IdVerificationInput): Promise<IdVerificationResult>;
}

export const ID_VERIFICATION_PROVIDER = Symbol('ID_VERIFICATION_PROVIDER');

/**
 * MOCK Fayda provider: deterministic from the id number so demos are repeatable.
 *  - id numbers ending in `00` are "not found" in the registry
 *  - id numbers ending in `99` "exist" but the name does not match (score 0.4)
 *  - everything else matches (score 0.97)
 */
@Injectable()
export class MockFaydaProvider implements IdVerificationProvider {
  readonly name = 'fayda';
  readonly isMock = true;
  private readonly logger = new Logger(MockFaydaProvider.name);

  async verify(input: IdVerificationInput): Promise<IdVerificationResult> {
    const digits = input.idNumber.replace(/\D/g, '');
    const tail = digits.slice(-2);
    this.logger.log(`[MOCK fayda] verifying ${input.idType} ****${digits.slice(-4)} for ${input.fullName}`);
    if (tail === '00') {
      return { provider: this.name, mock: true, found: false, score: 0, match: { fullName: false, dateOfBirth: false } };
    }
    if (tail === '99') {
      return { provider: this.name, mock: true, found: true, score: 0.4, match: { fullName: false, dateOfBirth: true } };
    }
    return { provider: this.name, mock: true, found: true, score: 0.97, match: { fullName: true, dateOfBirth: true } };
  }
}

/**
 * REAL Fayda eKYC client shape (OAuth2 client credentials -> `POST /v1/ekyc/verify`). The endpoint paths and payload
 * follow the public NIDP relying-party documentation and MUST be confirmed during onboarding. Enabled with
 * ID_VERIFICATION_PROVIDER=fayda + FAYDA_CLIENT_ID/SECRET.
 */
@Injectable()
export class FaydaProvider implements IdVerificationProvider {
  readonly name = 'fayda';
  readonly isMock = false;

  constructor(private readonly config: AppConfig) {}

  async verify(input: IdVerificationInput): Promise<IdVerificationResult> {
    const e = this.config.env;
    const tokenRes = await fetch(`${e.FAYDA_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: e.FAYDA_CLIENT_ID!,
        client_secret: e.FAYDA_CLIENT_SECRET!,
      }),
    });
    const token = ((await tokenRes.json()) as { access_token?: string }).access_token;
    if (!tokenRes.ok || !token) throw new Error(`Fayda token request failed (${tokenRes.status})`);
    const res = await fetch(`${e.FAYDA_BASE_URL}/v1/ekyc/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id_type: input.idType,
        id_number: input.idNumber,
        full_name: input.fullName,
        date_of_birth: input.dateOfBirth.toISOString().slice(0, 10),
      }),
    });
    const json = (await res.json()) as {
      found?: boolean;
      name_match?: boolean;
      dob_match?: boolean;
      score?: number;
    };
    if (!res.ok) throw new Error(`Fayda verification failed (${res.status})`);
    return {
      provider: this.name,
      mock: false,
      found: Boolean(json.found),
      score: json.score ?? (json.name_match && json.dob_match ? 1 : 0),
      match: { fullName: Boolean(json.name_match), dateOfBirth: Boolean(json.dob_match) },
      raw: json,
    };
  }
}
