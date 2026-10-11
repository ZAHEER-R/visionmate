const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();

exports.ensureSupabaseRole = onCall(async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before linking Supabase.");
  const user = await getAuth().getUser(request.auth.uid);
  if (user.customClaims?.role !== "authenticated") {
    await getAuth().setCustomUserClaims(user.uid, {
      ...user.customClaims,
      role: "authenticated"
    });
  }
  return { linked: true };
});
