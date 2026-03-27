import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
console.log("Firestore initialized with DB ID:", firebaseConfig.firestoreDatabaseId || "(default)");

// Safely initialize storage
let storageInstance = null;
if (firebaseConfig.storageBucket) {
  try {
    storageInstance = getStorage(app);
    console.log("Firebase Storage initialized with bucket:", firebaseConfig.storageBucket);
  } catch (error) {
    console.error("Firebase Storage initialization failed:", error);
  }
} else {
  console.warn("Firebase Storage bucket not found in config.");
}
export const storage = storageInstance;

export const googleProvider = new GoogleAuthProvider();
