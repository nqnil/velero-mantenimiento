export { initializeApp } from 'firebase/app';
export { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
export { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch } from 'firebase/firestore';
