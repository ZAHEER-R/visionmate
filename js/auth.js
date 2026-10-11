import { firebaseSignIn, firebaseSignOut } from "./firebase.js";

const PROFILE_KEY = "visionmate.profile";
const SESSION_KEY = "visionmate.session";
const USER_ID_KEY = "visionmate.userId";

const activeProfileKey = () => {
  const userId = localStorage.getItem(USER_ID_KEY);
  return userId ? `${PROFILE_KEY}.${userId}` : PROFILE_KEY;
};

export const auth = {
  getProfile() {
    try { return JSON.parse(localStorage.getItem(activeProfileKey()) || "null"); }
    catch (error) {
      console.error("Could not read the saved profile:", error);
      return null;
    }
  },
  saveProfile(profile) {
    localStorage.setItem(activeProfileKey(), JSON.stringify(profile));
    return profile;
  },
  getUserId() {
    return localStorage.getItem(USER_ID_KEY);
  },
  getSession() {
    return ["active", "guest"].includes(localStorage.getItem(SESSION_KEY));
  },
  isGuest() {
    return localStorage.getItem(SESSION_KEY) === "guest";
  },
  startGuestSession() {
    localStorage.removeItem(USER_ID_KEY);
    localStorage.setItem(SESSION_KEY, "guest");
    const profile = this.getProfile() || { firstName: "Guest", guest: true };
    this.saveProfile(profile);
    return profile;
  },
  async signOut() {
    if (!this.isGuest()) await firebaseSignOut();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_ID_KEY);
  },
  async signIn(method, credentials) {
    try {
      const result = await firebaseSignIn(method, credentials);
      if (result) {
        const current = this.isGuest() ? {} : this.getProfile() || {};
        localStorage.setItem(SESSION_KEY, "active");
        localStorage.setItem(USER_ID_KEY, result.user.uid);
        this.saveProfile({ ...current, email: result.user.email, name: current.name || result.user.displayName || "" });
        return { firebase: true, user: result.user, supabaseRoleError: result.supabaseRoleError };
      }
    } catch (error) {
      console.error("Authentication failed:", error);
      const message = error.code === "auth/operation-not-allowed"
        ? "This sign-in method is not enabled in Firebase yet."
        : error.code === "auth/unauthorized-domain"
          ? "Add this website's domain under Firebase Authentication → Settings → Authorized domains, then try Google sign-in again."
          : error.code === "auth/popup-blocked"
            ? "Your browser blocked the Google sign-in window. Allow pop-ups for this website and try again."
            : error.code === "auth/api-key-not-valid" || error.code === "auth/configuration-not-found"
              ? "Firebase Authentication is not configured for this web app. Add the correct Firebase web config and enable Google sign-in in Firebase Console."
        : error.code === "auth/email-already-in-use"
          ? "That email already has an account. Please log in instead."
          : error.code === "auth/weak-password"
            ? "Please choose a password with at least six characters."
            : error.code === "auth/invalid-credential" || error.code === "auth/wrong-password"
              ? "Those sign-in details don’t match. Please check them and try again."
              : error.message || "Sign-in failed. Please try again.";
      throw new Error(message);
    }
    if (method === "reset") return { firebase: false };
    throw new Error("Google/email sign-in cannot start because the Firebase Web App configuration is missing or incomplete. Set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID; enable the requested provider and authorize this website's domain in Firebase Console. You can continue as a guest without cloud sync.");
  }
};
