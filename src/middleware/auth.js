import { createRemoteJWKSet, jwtVerify } from "jose";

// Public keys of the Next.js client (Better Auth JWT plugin).
// Created once: the key set is cached inside this object, so tokens are verified
// without downloading the keys again on every request.
let jwks;
const getJwks = () => (jwks ??= createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)));

/**
 * Requires `Authorization: Bearer <jwt>`. On success the verified payload is
 * available as `req.user`.
 */
export async function verifyJWT(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!req.headers.authorization) {
    return res.status(401).send({ message: "Authorization header is missing" });
  }
  if (!token) {
    return res.status(401).send({ message: "Token is missing" });
  }

  try {
    const { payload } = await jwtVerify(token, getJwks());
    req.user = payload;
    next();
  } catch (err) {
    console.error("JWT verification error:", err.message);
    res.status(401).send({ message: "Invalid or expired token" });
  }
}

/**
 * The caller's email, read from the verified token only. Never trust an email sent
 * in the body or a header: anyone could put somebody else's address there.
 */
export const getEmail = (req) => req.user?.email;
