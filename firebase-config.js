import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged, 
    signOut, 
    EmailAuthProvider, 
    linkWithCredential, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCQOSvE07bNi2WfCymRdOabDewgYRs4UM4", 
    authDomain: "auction-system-e9801.firebaseapp.com",
    projectId: "auction-system-e9801",
    storageBucket: "auction-v2-img-999", 
    messagingSenderId: "1089558422014",
    appId: "1:1089558422014:web:4052e4b6e8f391c5a5a0af"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);


export { 
    app, 
    db, 
    auth, 
    signInAnonymously, 
    onAuthStateChanged, 
    signOut, 
    EmailAuthProvider, 
    linkWithCredential, 
    signInWithEmailAndPassword 
};
