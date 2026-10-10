import { firebaseSignIn } from "./firebase.js";

const PROFILE_KEY = "visionmate.profile";
const SESSION_KEY = "visionmate.session";

export const auth = {
  getProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); }
    catch (error) {
      console.error("Could not read the saved profile:", error);
      return null;
    }
  },
  saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  },
  getSession() {
    return localStorage.getItem(SESSION_KEY) === "active";
  },
  signOut() {
    localStorage.removeItem(SESSION_KEY);
  },
  async signIn(method, credentials) {
    try {
      const result = await firebaseSignIn(method, credentials);
      if (result) {
        localStorage.setItem(SESSION_KEY, "active");
        const user = result.user;
        const current = this.getProfile() || {};
        this.saveProfile({ ...current, email: user.email, name: current.name || user.displayName || "" });
        return { firebase: true, user };
      }
    } catch (error) {
      console.error("Authentication failed:", error);
      const message = error.code === "auth/operation-not-allowed"
        ? "This sign-in method is not enabled in Firebase yet."
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
    throw new Error("Firebase Authentication is not configured. Add the Firebase web app settings and enable the requested sign-in provider.");
  }
};
