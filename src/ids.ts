/** Deterministic ids, so converting the same export twice yields the same package. */

import { sha256Hex } from "./format/digest.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID-shaped id derived from the SHA-256 of `parts`. */
export async function ulidFromHash(...parts: string[]): Promise<string> {
	const hex = await sha256Hex(parts.join("\u0000"));
	let bits = BigInt(`0x${hex.slice(0, 32)}`);
	let id = "";
	for (let index = 0; index < 26; index++) {
		id = CROCKFORD[Number(bits & 31n)] + id;
		bits >>= 5n;
	}
	return id;
}
