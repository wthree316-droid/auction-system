import { supabase } from "./supabase-client.js";

const PYTHON_API_URL = "https://auction-backend-1089558422014.asia-southeast1.run.app"; 

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
            const { data: userCheck, error: userError } = await supabase.auth.getUser();
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

        if (error) {
            console.error("❌ Login Failed Details:", error);
            throw error;
        }
        
        // เติม uid ให้เหมือนเดิม
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
        // ... (ส่วนนี้เหมือนเดิม ไม่ได้แก้ Logic ฐานข้อมูล) ...
        // เพื่อความกระชับ ขอละไว้ (ใช้ code เดิมของคุณตรงนี้ได้เลย)
         console.log("🔗 Linking:", { email });

        const { data, error } = await supabase.auth.updateUser({ 
            email: email, 
            password: password 
        });

        if (error) {
            console.error("❌ Link Error Details:", error);
            if (error.message.includes("different from the old password")) {
                return { user: user, message: "Already linked" }; 
            }
            if (error.message.includes("already been registered")) {
                throw new Error("อีเมลนี้มีผู้ใช้งานแล้ว (กรุณาใช้อีเมลอื่น)");
            }
            if (error.message.includes("Password")) {
                throw new Error("รหัสผ่านต้องมีความยาว 6 ตัวอักษรขึ้นไป");
            }
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

        let { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (!data) {
            console.warn("⚠️ Profile missing! Auto-fixing...");
            const { error: insertError } = await supabase
                .from('profiles')
                .insert([{ id: id, username: 'Guest-' + id.slice(0,4) }]); 
                
            if (!insertError) {
                const retry = await supabase.from('profiles').select('*').eq('id', id).single();
                data = retry.data;
            }
        }
        
        return data || null; // คืนค่า object หรือ null
    },

    async updateProfile(id, updateData) {
        const { error } = await supabase.from('profiles').update(updateData).eq('id', id);
        if (error) throw error;
    },

    subscribeProfile(id, callback) {
        // เรียกครั้งแรก
        UserService.getUserProfile(id).then(callback);
        
        // Subscribe Realtime
        const channel = supabase.channel(`profile:${id}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${id}` }, 
                (payload) => callback(payload.new) // ✅ ส่ง object ใหม่ไปเลย
            )
            .subscribe();
    },

    async getDashboardData() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No session");

        const response = await fetch(`${PYTHON_API_URL}/users/me/dashboard`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error("Failed to fetch dashboard data");
        return await response.json();
    },

    async recoverAccount(currentUser, secretCode) {
        const { data: oldProfile, error } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('secret_code', secretCode)
            .single();

        if (error || !oldProfile) throw new Error("ไม่พบรหัสลับนี้");
        if (oldProfile.id === currentUser.id) throw new Error("บัญชีเดียวกัน");

        const { error: rpcError } = await supabase.rpc('migrate_guest_data', {
            old_user_id: oldProfile.id,
            new_user_id: currentUser.id
        });

        if (rpcError) throw new Error("กู้คืนล้มเหลว");
        return oldProfile.username;
    }
};

// ==========================================
// 3. Auction Service
// ==========================================
export const AuctionService = {
    subscribeAuctions(callback) {
        const fetch = () => supabase.from('auctions').select('*').eq('status', 'active')
            .then(({ data }) => callback(data || [])); // ✅ ส่ง Array ตรงๆ

        fetch();
        supabase.channel('public:auctions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, fetch)
            .subscribe();
    },
    
    subscribeAllAuctions(callback) {
        const fetch = () => supabase.from('auctions').select('*').order('created_at', { ascending: false })
            .then(({ data }) => callback(data || [])); // ✅ ส่ง Array ตรงๆ

        fetch();
        const channel = supabase.channel('public:all_auctions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, fetch)
            .subscribe();
        return () => supabase.removeChannel(channel);
    },

    subscribeAuctionDetail(id, callback) {
        const fetch = () => supabase.from('auctions').select('*').eq('id', id).single()
            .then(({ data }) => callback(data || null)); // ✅ ส่ง Object หรือ null

        fetch();
        supabase.channel(`auction:${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `id=eq.${id}` }, 
                (payload) => callback(payload.new) // ✅ ส่ง Object ใหม่
            )
            .subscribe();
        return () => {}; 
    },
    
    subscribeBids(auctionId, callback) {
        const fetch = () => supabase.from('bids').select('*').eq('auction_id', auctionId).order('created_at', { ascending: false })
            .then(({ data }) => callback(data || [])); // ✅ ส่ง Array
            
        fetch();
        supabase.channel(`bids:${auctionId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids', filter: `auction_id=eq.${auctionId}` }, fetch)
            .subscribe();
    },

    async createAuction(data) {
        const dbData = {
            title: data.title,
            description: data.description,
            category: data.category,
            image_url: data.image_url,
            images: [data.image_url],
            start_price: data.current_price,
            current_price: data.current_price,
            buy_now_price: data.buy_now_price,
            min_bid_increment: data.bid_increment,
            contact_email: data.contact_email,
            status: data.status || 'active',
            seller_id: data.seller_id,
            end_time: new Date(data.end_time).toISOString(),
            start_time: new Date().toISOString(),
            bid_count: 0,
            version: 1
        };

        const { error } = await supabase.from('auctions').insert(dbData);
        if (error) throw error;
    },

    async updateAuction(id, data) {
        const dbData = {};
        if (data.title !== undefined) dbData.title = data.title;
        if (data.description !== undefined) dbData.description = data.description;
        if (data.category !== undefined) dbData.category = data.category;
        if (data.image_url !== undefined) {
            dbData.image_url = data.image_url;
            dbData.images = [data.image_url];
        }
        if (data.buy_now_price !== undefined) dbData.buy_now_price = data.buy_now_price;
        if (data.contact_email !== undefined) dbData.contact_email = data.contact_email;
        if (data.end_time) {
            dbData.end_time = new Date(data.end_time).toISOString();
        }

        console.log("🚀 Updating Supabase:", dbData);
        const { error } = await supabase.from('auctions').update(dbData).eq('id', id);
        if (error) throw error;
    },
    
    async getAuctionById(id) {
         // ✅ คืนค่า Object ตรงๆ หรือ null
         const { data, error } = await supabase.from('auctions').select('*').eq('id', id).single();
         if (error) return null;
         return data;
    },

    async placeBid(auctionId, bidData) {
        // ✅ เพิ่ม Token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("กรุณาเข้าสู่ระบบก่อนประมูล");

        const response = await fetch(`${PYTHON_API_URL}/auctions/${auctionId}/bid`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ 
                amount: bidData.amount, 
                // bidder_id ไม่ต้องส่งก็ได้
            })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Bid Failed");
        }
    },
    
    async buyNow(auctionId, buyData) {
        // ✅ เพิ่ม Token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("กรุณาเข้าสู่ระบบก่อนซื้อสินค้า");

        const response = await fetch(`${PYTHON_API_URL}/auctions/${auctionId}/buy_now`, {
             method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ 
                amount: buyData.amount, 
                // buyer_id ไม่ต้องส่งก็ได้
            })
        });
         if (!response.ok) throw new Error("Buy Now Failed");
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
