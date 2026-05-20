import { firebaseConfig, isFirebaseConfigured } from '../firebaseConfig.js';

const FIREBASE_VERSION = '12.6.0';

class CloudSave {
    constructor() {
        this.configured = false;
        this.ready = false;
        this.user = null;
        this.auth = null;
        this.db = null;
        this.api = null;
        this.unsubscribeAuth = null;
        this.unsubscribeLeaderboard = null;
    }

    async init({ onAuthChange, onLeaderboardChange, onLoginError } = {}) {
        this.configured = isFirebaseConfigured();
        if (!this.configured) {
            onAuthChange?.({ configured: false, user: null, player: null });
            return { configured: false };
        }

        const [appModule, authModule, firestoreModule] = await Promise.all([
            import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
            import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
            import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
        ]);

        const app = appModule.getApps().length
            ? appModule.getApps()[0]
            : appModule.initializeApp(firebaseConfig);

        this.auth = authModule.getAuth(app);
        this.db = firestoreModule.getFirestore(app);
        this.api = { authModule, firestoreModule };
        this.ready = true;

        await authModule.setPersistence(this.auth, authModule.browserLocalPersistence);
        authModule.getRedirectResult(this.auth).catch((error) => {
            onLoginError?.(error);
        });

        this.unsubscribeAuth = authModule.onAuthStateChanged(this.auth, async (user) => {
            this.user = user;
            const player = user ? await this.ensurePlayer(user) : null;
            onAuthChange?.({ configured: true, user, player });
        });

        this.watchLeaderboard(onLeaderboardChange);
        return { configured: true };
    }

    async signIn() {
        if (!this.ready) return;
        const provider = new this.api.authModule.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await this.api.authModule.signInWithPopup(this.auth, provider);
    }

    async signInWithRedirect() {
        if (!this.ready) return;
        const provider = new this.api.authModule.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await this.api.authModule.signInWithRedirect(this.auth, provider);
    }

    async signOut() {
        if (!this.ready) return;
        await this.api.authModule.signOut(this.auth);
    }

    async ensurePlayer(user) {
        const { doc, getDoc, serverTimestamp, setDoc } = this.api.firestoreModule;
        const playerRef = doc(this.db, 'players', user.uid);
        const snap = await getDoc(playerRef);
        const base = {
            uid: user.uid,
            displayName: user.displayName || 'Player',
            photoURL: user.photoURL || '',
            updatedAt: serverTimestamp()
        };

        if (!snap.exists()) {
            await setDoc(playerRef, {
                ...base,
                coins: 0,
                bestScore: 0,
                bestWave: 0,
                runsPlayed: 0,
                createdAt: serverTimestamp()
            });
            return { coins: 0, bestScore: 0, bestWave: 0, runsPlayed: 0, ...base };
        }

        await setDoc(playerRef, base, { merge: true });
        return snap.data();
    }

    async saveCoins(coins) {
        if (!this.ready || !this.user) return;
        const { doc, serverTimestamp, setDoc } = this.api.firestoreModule;
        await setDoc(doc(this.db, 'players', this.user.uid), {
            coins,
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    async submitScore({ score, wave, coins }) {
        if (!this.ready || !this.user) return;

        const {
            doc,
            increment,
            runTransaction,
            serverTimestamp
        } = this.api.firestoreModule;
        const user = this.user;
        const playerRef = doc(this.db, 'players', user.uid);
        const leaderboardRef = doc(this.db, 'leaderboard', user.uid);

        await runTransaction(this.db, async (transaction) => {
            const playerSnap = await transaction.get(playerRef);
            const current = playerSnap.exists() ? playerSnap.data() : {};
            const bestScore = Math.max(Number(current.bestScore || 0), score);
            const bestWave = Math.max(Number(current.bestWave || 0), wave);
            const playerData = {
                uid: user.uid,
                displayName: user.displayName || 'Player',
                photoURL: user.photoURL || '',
                coins,
                bestScore,
                bestWave,
                runsPlayed: increment(1),
                updatedAt: serverTimestamp()
            };

            transaction.set(playerRef, playerData, { merge: true });

            if (score >= Number(current.bestScore || 0)) {
                transaction.set(leaderboardRef, {
                    uid: user.uid,
                    displayName: user.displayName || 'Player',
                    photoURL: user.photoURL || '',
                    bestScore: score,
                    bestWave: wave,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }
        });
    }

    watchLeaderboard(onLeaderboardChange) {
        if (!onLeaderboardChange) return;
        const {
            collection,
            limit,
            onSnapshot,
            orderBy,
            query
        } = this.api.firestoreModule;
        const leaderboardQuery = query(
            collection(this.db, 'leaderboard'),
            orderBy('bestScore', 'desc'),
            limit(8)
        );

        this.unsubscribeLeaderboard = onSnapshot(leaderboardQuery, (snapshot) => {
            onLeaderboardChange(snapshot.docs.map((docSnap) => docSnap.data()));
        });
    }

    isSignedIn() {
        return Boolean(this.user);
    }
}

export const cloudSave = new CloudSave();
