import { APP_CONFIG } from "./config.js";

let firebaseAuth = null;
let initAttempted = false;

export async function initializeFirebase() {
  if (initAttempted) return firebaseAuth;
  if (!APP_CONFIG.firebase.apiKey || APP_CONFIG.firebase.apiKey.startsWith("YOUR_")) return null;
  try {
    const appSdk = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const authSdk = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const app = appSdk.initializeApp(APP_CONFIG.firebase);
    firebaseAuth = { auth: authSdk.getAuth(app), sdk: authSdk };
    initAttempted = true;
    return firebaseAuth;
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    throw new Error("Firebase could not be initialized. Check the Firebase configuration and network connection.");
  }
}

export async function firebaseSignIn(method, credentials = {}) {
  const instance = await initializeFirebase();
  if (!instance) return null;
  const { auth, sdk } = instance;
  if (method === "google") {
    const provider = new sdk.GoogleAuthProvider();
    return sdk.signInWithPopup(auth, provider);
  }
  if (method === "create") return sdk.createUserWithEmailAndPassword(auth, credentials.email, credentials.password);
  if (method === "login") return sdk.signInWithEmailAndPassword(auth, credentials.email, credentials.password);
  if (method === "reset") return sdk.sendPasswordResetEmail(auth, credentials.email);
  throw new Error("Unsupported sign-in method.");
}

export async function saveFirebaseProfile(profile) {
  const instance = await initializeFirebase();
  if (!instance?.auth.currentUser) return false;
  if (!APP_CONFIG.firebase.databaseURL) throw new Error("Set the Firebase Realtime Database URL in js/config.js.");
  const databaseSdk = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
  const database = databaseSdk.getDatabase(instance.auth.app, APP_CONFIG.firebase.databaseURL);
  const currentUser = instance.auth.currentUser;
  await databaseSdk.set(databaseSdk.ref(database, `users/${currentUser.uid}/profile`), {
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    age: profile.age || null,
    gender: profile.gender || "",
    email: currentUser.email || "",
    updatedAt: new Date().toISOString()
  });
  return true;
}

export async function linkEmailOtp(email, password) {
  const instance = await initializeFirebase();
  if (!instance) throw new Error("Add Firebase configuration before linking an account.");
  const credential = instance.sdk.EmailAuthProvider.credential(email, password);
  return instance.sdk.linkWithCredential(instance.auth.currentUser, credential);
}
