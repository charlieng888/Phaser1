export const firebaseConfig = {
    // Paste your Firebase web app config values here.
    // Firebase console path:
    // Project settings > General > Your apps > Web app > SDK setup and configuration > Config
    apiKey: 'AIzaSyB6yelfQQf1D8tEgkYmtaveeCSDN57EWsc',
    authDomain: 'charlie-game.firebaseapp.com',
    projectId: 'charlie-game',
    storageBucket: 'charlie-game.firebasestorage.app',
    messagingSenderId: '537460087223',
    appId: '1:537460087223:web:0df2e7d59b2681b75a7032'
};

export function isFirebaseConfigured() {
    return ['apiKey', 'authDomain', 'projectId', 'appId'].every((key) => {
        const value = firebaseConfig[key];
        return typeof value === 'string' && value.trim().length > 0;
    });
}
