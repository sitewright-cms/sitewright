import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * The registration response a ROUTE test posts when @simplewebauthn/server's verification is mocked.
 *
 * The verification is mocked; what comes before it is not. The server strips the attestation
 * statement from every registration before the library sees it (see `withoutAttestationStatement`),
 * and to do that it really decodes the attestation object — so the fake response has to carry one.
 * This is the smallest: format `none`, no statement, and authenticator data nothing reads.
 */
const ATTESTATION_OBJECT = isoBase64URL.fromBuffer(
  new Uint8Array(
    isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(37)],
      ]) as never,
    ),
  ),
);

export function registrationOf(id: string): { id: string; response: { attestationObject: string } } {
  return { id, response: { attestationObject: ATTESTATION_OBJECT } };
}
