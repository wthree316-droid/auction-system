import { supabase } from "./supabase-client.js"; // ใช้ Supabase Upload รูปเหมือนเดิม
import { 
    auth, 
    signInAnonymously, 
    onAuthStateChanged, 
    signOut, 
    EmailAuthProvider, 
    linkWithCredential, 
    signInWithEmailAndPassword 
} from "./firebase-config.js";

// ==========================================
// 🔧 CONFIGURATION
// ==========================================
const API_BASE_URL = "https://"; 
const WS_URL = "wss:///ws";     
// ==========================================
// 🔌 WebSocket Manager (Real-time Engine)
// ==========================================
class WebSocketManager {
    constructor() {
        this.socket = null;
        this.listeners = [];
        this.connect();
    }

    connect() {
        this.socket = new WebSocket(WS_URL);
        
        this.socket.onopen = () => {
            console.log("🟢 Connected to Python Real-time Server");
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("⚡ Real-time update:", data);
                // แจ้งเตือนทุก listener ที่ลงทะเบียนไว้
                this.listeners.forEach(callback => callback(data));
            } catch (e) {
                console.error("WS Parse Error:", e);
            }
        };

        this.socket.onclose = () => {
            console.log("🔴 Disconnected. Reconnecting in 3s...");
            setTimeout(() => this.connect(), 3000);
        };
    }

    subscribe(callback) {
        this.listeners.push(callback);
        // Return unsubscribe function
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }
}

const wsManager = new WebSocketManager();

// ==========================================
// 🛠️ HELPER: API Fetcher
// ==========================================
async function apiCall(endpoint, method = "GET", body = null) {
    const headers = { "Content-Type": "application/json" };
    
    // 1. เช็คว่ามี User Login ไหม และแปะ Token ไปด้วย
    if (auth.currentUser) {
        try {
            const token = await auth.currentUser.getIdToken();
            headers["Authorization"] = `Bearer ${token}`;
            // console.log("🔑 Attached Token:", token.substring(0, 10) + "..."); // อยากเช็ค Token ให้เปิดบรรทัดนี้
        } catch (err) {
            console.error("⚠️ Get Token Error:", err);
        }
    }

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    // 2. ปริ้นท์ Log ก่อนยิง (ช่วยเช็คว่า URL ถูกไหม)
    console.log(`🚀 API Request: [${method}] ${API_BASE_URL}${endpoint}`, body);

    try {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, config);
        
        // 3. ถ้า Backend ตอบ 404 (ไม่เจอ API)
        if (res.status === 404) {
            console.error("❌ API Not Found (404)");
            throw new Error("404 Not Found");
        }    

        // 4. ถ้า Backend ตอบ Error อื่นๆ (เช่น 400, 422, 500)
        if (!res.ok) {
            const errData = await res.json();
            console.error("❌ API Response Error:", errData); // ดู Error เต็มๆ จาก Python
            
            // พยายามดึงข้อความ Error ออกมาโชว์
            const errorMsg = errData.detail ? 
                (typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail)) 
                : `API Error: ${res.status}`;
            
            throw new Error(errorMsg);
        }

        // 5. สำเร็จ!
        const result = await res.json();
        console.log("✅ API Success:", result);
        return result;

    } catch (error) {
        // 6. ดักจับ Error ที่เกิดจาก Network (เช่น ต่อ Server ไม่ได้, CORS, URL ผิด)
        if (error.message === "Failed to fetch") {
            console.error("🔥 Network Error: เชื่อมต่อ Server ไม่ได้ (เช็ค URL หรือ เปิด Server หรือยัง?)");
            throw new Error("ไม่สามารถเชื่อมต่อ Server ได้ กรุณาตรวจสอบอินเทอร์เน็ต");
        }
        
        if (error.message !== "404 Not Found") {
            console.error("💥 Unknown API Error:", error);
        }
        throw error;
    }
}

// 🛠️ HELPER: แปลง JSON จาก Python ให้หน้าตาเหมือน Firebase Snapshot
// เพื่อให้ app.js เดิมทำงานต่อได้โดยไม่ต้องแก้เยอะ
function mockSnapshot(dataList) {
    const docs = dataList.map(item => ({
        id: item.id,
        data: () => item,
        exists: () => true,
        ref: { id: item.id } // Mock ref
    }));
    
    return {
        docs: docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (cb) => docs.forEach(cb)
    };
}

function mockDocSnapshot(item) {
    return {
        id: item ? item.id : "unknown",
        exists: () => !!item,
        data: () => item
    };
}

// ==========================================
// 1. Authentication Service
// ==========================================
export const AuthService = {
    async loginAnonymous() {
        return await signInAnonymously(auth);
    },

    onUserChange(callback) {
        return onAuthStateChanged(auth, callback);
    },
    async linkEmailAccount(currentUser, email, password) {
        const credential = EmailAuthProvider.credential(email, password);
        return await linkWithCredential(currentUser, credential);
    },
    async loginWithEmail(email, password) {
        return await signInWithEmailAndPassword(auth, email, password);
    },
    async getClientIp() {
        // ให้ Python Backend อ่าน IP แล้วส่งกลับมาจะแม่นยำกว่า
        try {
            const res = await apiCall("/utils/client-ip");
            return res.ip;
        } catch (e) {
            return "127.0.0.1"; // Default
        }
    },
    async logout() {
        return await signOut(auth);
    }
};

// ==========================================
// 2. User Data Service
// ==========================================
export const UserService = {
    async getUserProfile(uid) {
        try {
            const userData = await apiCall(`/users/${uid}`);
            return mockDocSnapshot(userData);
        } catch (e) {
            // กรณีไม่เจอ user (404) ให้ส่ง snapshot แบบ exists=false
            return { exists: () => false, data: () => null };
        }
    },

    async createProfile(uid, data) {
        return await apiCall(`/users/${uid}`, "POST", data);
    },

    async updateProfile(uid, data) {
        return await apiCall(`/users/${uid}`, "PUT", data);
    },

    subscribeProfile(uid, callback) {
        // 1. ดึงข้อมูลครั้งแรกทันที
        this.getUserProfile(uid).then(callback);
        
        // 2. ✅ ฟังเสียงกระซิบจาก WebSocket (ถ้า Backend ตะโกนมา ให้ดึงใหม่)
        return wsManager.subscribe((msg) => {
            // ถ้าข้อความบอกว่า "USER_UPDATE" และเป็น UID ของเรา
            if (msg.type === "USER_UPDATE" && msg.uid === uid) {
                console.log("♻️ Profile updated! Refreshing UI...");
                this.getUserProfile(uid).then(callback);
            }
        });
    },

async recoverAccount(currentUser, secretCode) { // 1. เปลี่ยนชื่อตัวรับเป็น Input เพื่อไม่ให้ชื่อชนกัน
        
        // 🛡️ Safe Check: รองรับทั้งแบบส่ง User Object มา หรือส่ง UID มาตรงๆ
        const uid = currentUser.uid ? currentUser.uid : currentUser;
        
        // 2. ค่า secretCode ที่ส่งมาเป็น String อยู่แล้ว ใช้ได้เลย (ไม่ต้องเช็ค .uid)
        const code = secretCode; 

        console.log("🚀 Sending Recovery:", { current_uid: uid, secret_code: code });

        const res = await apiCall("/users/recover", "POST", {
            current_uid: uid,
            secret_code: code 
        });
        
        return res.old_display_name;
    },

    async getDashboardData() {
        return await apiCall("/users/me/dashboard");
    }
};

// ==========================================
// 3. Product/Auction Service
// ==========================================
export const AuctionService = {
    // 🔄 Realtime List
    subscribeAuctions(callback) {
        const fetchAndCallback = async () => {
            try {
                const data = await apiCall("/auctions");
                callback(mockSnapshot(data));
            } catch (e) { console.error(e); }
        };

        // 1. เรียกทันที
        fetchAndCallback();

        // 2. เมื่อมี Event การประมูล หรือ สินค้าใหม่ ให้โหลดใหม่
        return wsManager.subscribe((msg) => {
            if (["NEW_BID", "AUCTION_ENDED", "NEW_ITEM", "ITEM_UPDATE"].includes(msg.type)) {
                fetchAndCallback();
            }
        });
    },

    // 🔄 Realtime Detail
    subscribeAuctionDetail(id, callback) {
        const fetchAndCallback = async () => {
            try {
                const data = await apiCall(`/auctions/${id}`);
                callback(mockDocSnapshot(data));
            } catch (e) { console.error(e); }
        };

        fetchAndCallback();

        return wsManager.subscribe((msg) => {
            // อัปเดตเฉพาะถ้ารหัสสินค้าตรงกัน
            if ((msg.type === "NEW_BID" || msg.type === "ITEM_UPDATE") && msg.item_id === id) {
                fetchAndCallback();
            }
        });
    },

    async getAuctionById(id) {
        try {
            const data = await apiCall(`/auctions/${id}`);
            return mockDocSnapshot(data);
        } catch (e) {
            return { exists: () => false };
        }
    },

    async createAuction(data) {
        // ส่งข้อมูลไป Python
        return await apiCall("/auctions", "POST", data);
    },

    async updateAuction(id, data) {
        return await apiCall(`/auctions/${id}`, "PUT", data);
    },

    async placeBid(auctionId, bidData, productData) {
        // Logic ตรวจสอบราคาย้ายไป Python แล้ว
        return await apiCall(`/auctions/${auctionId}/bid`, "POST", {
            amount: bidData.amount,
            bidder_uid: bidData.bidder_uid,
            bidder_name: bidData.bidder_name
        });
    },

    async buyNow(auctionId, buyData) {
        return await apiCall(`/auctions/${auctionId}/buy_now`, "POST", {
            amount: buyData.amount,
            buyer_uid: buyData.buyer_uid,
            buyer_name: buyData.bidder_name
        });
    },

    subscribeBids(auctionId, callback) {
        const fetchAndCallback = async () => {
            try {
                // สมมติว่า Backend มี Endpoint ดึงประวัติ
                const bids = await apiCall(`/auctions/${auctionId}/bids`);
                callback(mockSnapshot(bids));
            } catch (e) { console.error(e); }
        };

        fetchAndCallback();

        return wsManager.subscribe((msg) => {
            if (msg.type === "NEW_BID" && msg.item_id === auctionId) {
                fetchAndCallback();
            }
        });
    },
    
    async getBidsOnce(auctionId) {
        const bids = await apiCall(`/auctions/${auctionId}/bids`);
        return mockSnapshot(bids);
    }
};

// ==========================================
// 4. Storage Service (Supabase)
// ==========================================
export const StorageService = {
    // ใช้ Client Upload เหมือนเดิม เพื่อลดภาระ Backend Python ในระยะแรก
    async uploadImage(file) {
        const fileExt = file.name.split('.').pop();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileName = `${Date.now()}_${randomString}.${fileExt}`;
        
        const { error } = await supabase.storage.from('product-images').upload(fileName, file);
        if (error) throw new Error("Upload Failed: " + error.message);
        
        const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
        return data.publicUrl;
    }
};
