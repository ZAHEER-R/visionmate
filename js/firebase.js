import { APP_CONFIG } from "./config.js";

let initialization;

export async function initializeFirebase() {
  if (!initialization) {
    initialization = (async () => {
      const requiredSettings = ["apiKey", "authDomain", "projectId", "appId"];
      if (requiredSettings.some(key => {
        const value = APP_CONFIG.firebase[key];
        return typeof value !== "string" || !value || value.startsWith("YOUR_");
      })) return null;
      const appSdk = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const authSdk = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      const app = appSdk.initializeApp(APP_CONFIG.firebase);
      return { auth: authSdk.getAuth(app), sdk: authSdk };
    })().catch(error => {
      initialization = undefined;
      console.error("Firebase initialization failed:", error);
      throw new Error("Firebase could not be initialized. Check the Firebase configuration and network connection.");
    });
  }
  return initialization;
}

export async function firebaseSignIn(method, credentials = {}) {
  const instance = await initializeFirebase();
  if (!instance) return null;
  const { auth, sdk } = instance;
  let result;
  if (method === "google") {
    const provider = new sdk.GoogleAuthProvider();
    result = await sdk.signInWithPopup(auth, provider);
  } else if (method === "create") {
    result = await sdk.createUserWithEmailAndPassword(auth, credentials.email, credentials.password);
  } else if (method === "login") {
    result = await sdk.signInWithEmailAndPassword(auth, credentials.email, credentials.password);
  } else if (method === "reset") {
    return sdk.sendPasswordResetEmail(auth, credentials.email);
  } else {
    throw new Error("Unsupported sign-in method.");
  }
  let supabaseRoleError = "";
  try {
    await ensureSupabaseRole(result.user, auth);
  } catch (error) {
    supabaseRoleError = error instanceof Error ? error.message : String(error);
    console.error("Firebase sign-in succeeded, but Supabase account sync setup failed:", error);
  }
  return { ...result, supabaseRoleError };
}

async function ensureSupabaseRole(user, auth) {
  const token = await user.getIdTokenResult();
  if (token.claims.role === "authenticated") return;
  const functionsSdk = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js");
  const functions = functionsSdk.getFunctions(auth.app);
  await functionsSdk.httpsCallable(functions, "ensureSupabaseRole")();
  await user.getIdToken(true);
}

export async function getFirebaseUser() {
  const instance = await initializeFirebase();
  if (!instance) return null;
  if (instance.auth.currentUser) return instance.auth.currentUser;
  return new Promise((resolve, reject) => {
    let unsubscribe;
    unsubscribe = instance.sdk.onAuthStateChanged(
      instance.auth,
      user => {
        unsubscribe();
        resolve(user);
      },
      error => {
        unsubscribe();
        reject(error);
      }
    );
  });
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

export async function firebaseSignOut() {
  const instance = await initializeFirebase();
  if (!instance) return false;
  await instance.sdk.signOut(instance.auth);
  return true;
}
