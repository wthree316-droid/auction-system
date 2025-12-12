import { supabase } from "./supabase-client.js";

const PYTHON_API_URL = "https://auction-backend-1089558422014.asia-southeast1.run.app"; 

// Helper สำหรับยิง API พร้อม Token
async function fetchWithAuth(url, method, body = null) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("กรุณาเข้าสู่ระบบก่อนทำรายการ");

    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        }
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.detail || "เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์");
    }
    return result;
}

// ==========================================
// 1. Authentication Service
// ==========================================
export const AuthService = {
    async getClientIp() {
        return "127.0.0.1";  
    },

    async loginAnonymous() {
        const { data, error } = await supabase.auth.getSession();

        if (data.session) {
            // เช็คว่า Session ยังใช้ได้จริงไหม
            const { error: userError } = await supabase.auth.getUser();
            if (userError) {
                console.warn("🧟 Found Zombie Session. Killing it...", userError.message);
                await supabase.auth.signOut();
                localStorage.clear();
            } else {
                return data.session.user;
            }
        }

        console.log("👻 Creating new Guest...");
        const { data: newData, error: newError } = await supabase.auth.signInAnonymously();
        if (newError) throw newError;
        return newData.user;
    },
    
    async loginWithEmail(email, password) {
        console.log("🔑 Attempting Login:", email);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;
        if (data.user) data.user.uid = data.user.id;
        return data.user;
    },

    onUserChange(callback) {
        return supabase.auth.onAuthStateChange((event, session) => {
            console.log("Auth Event:", event);
            callback(session?.user || null);
        });
    },

    async logout() {
        return await supabase.auth.signOut();
    },

    async linkEmailAccount(user, email, password) {
         console.log("🔗 Linking:", { email });
        const { data, error } = await supabase.auth.updateUser({ 
            email: email, 
            password: password 
        });

        if (error) {
            console.error("❌ Link Error Details:", error);
            if (error.message.includes("different from the old password")) return { user: user, message: "Already linked" }; 
            if (error.message.includes("already been registered")) throw new Error("อีเมลนี้มีผู้ใช้งานแล้ว");
            if (error.message.includes("Password")) throw new Error("รหัสผ่านต้องมีความยาว 6 ตัวอักษรขึ้นไป");
            throw error;
        }
        return data;
    }
};

// ==========================================
// 2. User Service
// ==========================================
export const UserService = {
    async getUserProfile(id) {
        // ใช้ maybeSingle() ปลอดภัยกว่า
        const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
        // ไม่ต้องมี Auto-fix ตรงนี้แล้ว Database Trigger จัดการให้
        return data || null; 
    },

    async updateProfile(id, updateData) {
        // 🔒 SECURE: ยิงไปที่ Python Backend แทนการเขียนตรง
        // เพื่อให้ Backend กรองข้อมูล (เช่น ห้ามแก้ secret_code หรือ สถานะแบน)
        return await fetchWithAuth(`${PYTHON_API_URL}/users/${id}`, 'PUT', updateData);
    },

    subscribeProfile(id, callback) {
        UserService.getUserProfile(id).then(callback);
        
        const channel = supabase.channel(`profile:${id}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${id}` }, 
                (payload) => callback(payload.new)
            )
            .subscribe();
    },

    async getDashboardData() {
        return await fetchWithAuth(`${PYTHON_API_URL}/users/me/dashboard`, 'GET');
    },

    async recoverAccount(currentUser, secretCode) {
        // 🔒 SECURE: ยิงไปที่ Python Backend
        // เพราะ Client ไม่มีสิทธิ์อ่าน Secret Code ของคนอื่นจาก Database โดยตรง
        const result = await fetchWithAuth(`${PYTHON_API_URL}/users/recover`, 'POST', {
            current_uid: currentUser.id,
            secret_code: secretCode
        });
        return result.old_display_name;
    }
};

// ==========================================
// 3. Auction Service
// ==========================================
export const AuctionService = {
    subscribeAuctions(callback) {
        const fetch = () => supabase.from('auctions').select('*').eq('status', 'active')
            .then(({ data }) => callback(data || []));

        fetch();
        supabase.channel('public:auctions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, fetch)
            .subscribe();
    },
    
    subscribeAllAuctions(callback) {
        const fetch = () => supabase.from('auctions').select('*').order('created_at', { ascending: false })
            .then(({ data }) => callback(data || []));

        fetch();
        const channel = supabase.channel('public:all_auctions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, fetch)
            .subscribe();
        return () => supabase.removeChannel(channel);
    },

    subscribeAuctionDetail(id, callback) {
        const fetch = () => supabase.from('auctions').select('*').eq('id', id).single()
            .then(({ data }) => callback(data || null));

        fetch();
        supabase.channel(`auction:${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `id=eq.${id}` }, 
                (payload) => callback(payload.new)
            )
            .subscribe();
        return () => {}; 
    },
    
    subscribeBids(auctionId, callback) {
        const fetch = () => supabase.from('bids').select('*').eq('auction_id', auctionId).order('created_at', { ascending: false })
            .then(({ data }) => callback(data || []));
            
        fetch();
        supabase.channel(`bids:${auctionId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids', filter: `auction_id=eq.${auctionId}` }, fetch)
            .subscribe();
    },

    async createAuction(data) {
        // 🔒 SECURE: ส่งไป Backend เพื่อเช็คสิทธิ์และ validate ข้อมูล
        // Backend จะเป็นคนเติม created_at, seller_id ให้เอง
        return await fetchWithAuth(`${PYTHON_API_URL}/auctions/`, 'POST', data);
    },

    async updateAuction(id, data) {
        // 🔒 SECURE: ส่งไป Backend เพื่อเช็คว่าเราเป็นเจ้าของจริงไหม
        return await fetchWithAuth(`${PYTHON_API_URL}/auctions/${id}`, 'PUT', data);
    },
    
    async getAuctionById(id) {
         const { data, error } = await supabase.from('auctions').select('*').eq('id', id).single();
         if (error) return null;
         return data;
    },

    async placeBid(auctionId, bidData) {
        // 🔒 SECURE: ใช้ fetchWithAuth
        await fetchWithAuth(`${PYTHON_API_URL}/auctions/${auctionId}/bid`, 'POST', { 
            amount: bidData.amount
        });
    },
    
    async buyNow(auctionId, buyData) {
        // 🔒 SECURE: ใช้ fetchWithAuth
        await fetchWithAuth(`${PYTHON_API_URL}/auctions/${auctionId}/buy_now`, 'POST', { 
            amount: buyData.amount 
        });
    }
};

export const StorageService = {
    async uploadImage(file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error } = await supabase.storage.from('product-images').upload(fileName, file);
        if (error) throw error;
        const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
        return data.publicUrl;
    }
};
