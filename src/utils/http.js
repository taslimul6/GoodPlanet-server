/**
 * Wraps a route handler: any thrown error is logged and answered with a 500 and
 * `failMessage`, so handlers do not need their own try/catch.
 */
export const route = (failMessage, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`${failMessage}:`, err);
    res.status(500).send({ message: failMessage });
  }
};

/**
 * Wraps a handler that needs a logged-in caller. The email is passed as the third
 * argument; if the token has none, the request is rejected with 400.
 */
export const withEmail = (failMessage, handler) =>
  route(failMessage, async (req, res) => {
    const email = req.user?.email;
    if (!email) return res.status(400).send({ message: "Email is required" });
    await handler(req, res, email);
  });
