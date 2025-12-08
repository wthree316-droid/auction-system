import { supabase } from "./supabase-client.js";

const PYTHON_API_URL = "http://127.0.0.1:8000"; 

// ==========================================
// 1. Authentication Service
// ==========================================
export const AuthService = {
    async getClientIp() {
        return "127.0.0.1";  
    },

    async loginAnonymous() {
        // 1. ลองดึง Session จากเครื่องมาก่อน
        const { data, error } = await supabase.auth.getSession();

        if (data.session) {
            // 🛑 จุดสำคัญ: อย่าเพิ่งเชื่อ Session ในเครื่อง! 
            // ให้ลองยิงไปเช็คกับ Server จริงๆ ว่า User นี้ยังอยู่ไหม?
            const { data: userCheck, error: userError } = await supabase.auth.getUser();

            if (userError) {
                console.warn("🧟 Found Zombie Session (User deleted on server). Killing it...", userError.message);
                
                // ถ้า Server บอกว่า Error (หาไม่เจอ/Token ผิด) -> ล้างทิ้งทันที
                await supabase.auth.signOut();
                localStorage.clear(); // ล้างให้เกลี้ยง
                
                // แล้วไปเข้าข้อ 2 เพื่อสร้างใหม่
            } else {
                // ถ้า Server บอกโอเค -> ใช้คนเดิมได้
                return data.session.user;
            }
        }

        // 2. ถ้าไม่มี Session หรือ Session เสีย (โดนลบด้านบน) -> สร้าง Guest ใหม่
        console.log("👻 Creating new Guest...");
        const { data: newData, error: newError } = await supabase.auth.signInAnonymously();
        
        if (newError) throw newError;
        return newData.user;
    },

    async loginWithEmail(email, password) {
        console.log("🔑 Attempting Login:", email); // เช็คว่าอีเมลถูกไหม

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            console.error("❌ Login Failed Details:", error); // ดูรายละเอียดตรงนี้
            throw error; // ส่ง error กลับไปให้หน้าเว็บแจ้งเตือน
        }
        
        console.log("✅ Login Success:", data.user.id);
        
        // เติม uid ให้เหมือนเดิม (เพื่อให้ app.js ทำงานต่อได้)
        if (data.user) data.user.uid = data.user.id;
        
        return data.user;
    },

    onUserChange(callback) {
        return supabase.auth.onAuthStateChange((event, session) => {
            console.log("Auth Event:", event);
            // ✅ ส่ง User ของ Supabase ไปตรงๆ เลย (มี .id, .is_anonymous อยู่แล้ว)
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

            // ✅ 1. ดัก Error: รหัสผ่านซ้ำ (แปลว่าเคยเชื่อมไปแล้ว) -> ให้ผ่านได้เลย
            if (error.message.includes("different from the old password")) {
                console.warn("⚠️ Password is the same. Treating as success.");
                return { user: user, message: "Already linked" }; 
            }

            // ✅ 2. ดัก Error: อีเมลซ้ำ (อันนี้ต้องแจ้งเตือน)
            if (error.message.includes("already been registered")) {
                throw new Error("อีเมลนี้มีผู้ใช้งานแล้ว (กรุณาใช้อีเมลอื่น)");
            }

            // ✅ 3. ดัก Error: รหัสผ่านสั้นเกินไป
            if (error.message.includes("Password")) {
                throw new Error("รหัสผ่านต้องมีความยาว 6 ตัวอักษรขึ้นไป");
            }

            // Error อื่นๆ ที่ไม่รู้จัก ให้พ่นออกมา
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

        // Logic ซ่อม Profile หาย
        if (!data) {
            console.warn("⚠️ Profile missing! Auto-fixing...");
            const { error: insertError } = await supabase
                .from('profiles')
                .insert([{ id: id, username: 'Guest-' + id.slice(0,4) }]); // DB trigger จะสร้าง secret_code ให้เอง
                
            if (!insertError) {
                const retry = await supabase.from('profiles').select('*').eq('id', id).single();
                data = retry.data;
            }
        }
        
        if (!data) return { exists: () => false, data: () => null };
        return { exists: () => true, data: () => data };
    },

    async updateProfile(id, updateData) {
        // ส่ง updateData ไปตรงๆ (key ต้องเป็น username, contact_email ฯลฯ)
        const { error } = await supabase.from('profiles').update(updateData).eq('id', id);
        if (error) throw error;
    },

    subscribeProfile(id, callback) {
        UserService.getUserProfile(id).then(callback);
        const channel = supabase.channel(`profile:${id}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${id}` }, 
                (payload) => callback({ exists: () => true, data: () => payload.new })
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
        if (oldProfile.id === currentUser.id) throw new Error("บัญชีเดียวกัน"); // ✅ ใช้ .id

        const { error: rpcError } = await supabase.rpc('migrate_guest_data', {
            old_user_id: oldProfile.id,
            new_user_id: currentUser.id // ✅ ใช้ .id
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
            .then(({ data }) => callback(cleanSnapshot(data || [])));

        fetch();
        supabase.channel('public:auctions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, fetch)
            .subscribe();
    },
    
    // ดึงทั้งหมด (รวม Sold) สำหรับ History
    subscribeAllAuctions(callback) {
        const fetch = () => supabase.from('auctions').select('*').order('created_at', { ascending: false })
            .then(({ data }) => callback(cleanSnapshot(data || [])));

        fetch();
        const channel = supabase.channel('public:all_auctions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, fetch)
            .subscribe();
        return () => supabase.removeChannel(channel);
    },

    subscribeAuctionDetail(id, callback) {
        const fetch = () => supabase.from('auctions').select('*').eq('id', id).single()
            .then(({ data }) => callback({ exists: () => !!data, data: () => data }));

        fetch();
        supabase.channel(`auction:${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `id=eq.${id}` }, 
                (payload) => callback({ exists: () => true, data: () => payload.new })
            )
            .subscribe();
        return () => {}; 
    },
    
    subscribeBids(auctionId, callback) {
        const fetch = () => supabase.from('bids').select('*').eq('auction_id', auctionId).order('created_at', { ascending: false })
            .then(({ data }) => callback(cleanSnapshot(data || [])));
            
        fetch();
        supabase.channel(`bids:${auctionId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids', filter: `auction_id=eq.${auctionId}` }, fetch)
            .subscribe();
    },

async createAuction(data) {
    // รับข้อมูลดิบมา แล้วจัดลงกล่องใหม่ให้ตรงกับ Database เป๊ะๆ
    const dbData = {
        title: data.title,
        description: data.description,
        category: data.category,
        image_url: data.image_url,
        images: [data.image_url], // แถมใส่ Array ให้

        // Mapping ราคา
        start_price: data.current_price, // ต้องมี start_price
        current_price: data.current_price,
        buy_now_price: data.buy_now_price,
        min_bid_increment: data.bid_increment, // ✅ รับ bid_increment มาใส่ min_bid_increment

        contact_email: data.contact_email,
        status: data.status || 'active',
        seller_id: data.seller_id,
        
        // แปลงเวลา
        end_time: new Date(data.end_time).toISOString(), // ✅ แปลง ms เป็น ISO
        start_time: new Date().toISOString(), // ✅ สร้างเวลาเริ่มให้อัตโนมัติ
        
        bid_count: 0,
        version: 1
    };

    const { error } = await supabase.from('auctions').insert(dbData);
    if (error) throw error;
},

    async updateAuction(id, data) {
    // 1. สร้าง Object สำหรับส่งเข้า DB โดยเฉพาะ
    const dbData = {};

    // 2. เช็คทีละตัวว่ามีค่าส่งมาไหม? ถ้ามีค่อยใส่ (Partial Update)
    if (data.title !== undefined) dbData.title = data.title;
    if (data.description !== undefined) dbData.description = data.description;
    if (data.category !== undefined) dbData.category = data.category;
    if (data.image_url !== undefined) {
        dbData.image_url = data.image_url;
        dbData.images = [data.image_url]; // อัปเดตทั้ง 2 ช่อง
    }
    if (data.buy_now_price !== undefined) dbData.buy_now_price = data.buy_now_price;
    if (data.contact_email !== undefined) dbData.contact_email = data.contact_email;
    
    // ⚠️ จุดสำคัญ: แปลงเวลาให้ถูกต้อง
    // app.js ส่งมาชื่อ 'end_time' (ค่าเป็นตัวเลข ms)
    if (data.end_time) {
        dbData.end_time = new Date(data.end_time).toISOString();
    }
    // หรือถ้าส่งมาชื่อ 'end_time_ms'
    if (data.end_time) {
        dbData.end_time = new Date(data.end_time).toISOString();
    }

    console.log("🚀 Updating Supabase:", dbData); // ดู Log ความชัวร์

    const { error } = await supabase.from('auctions').update(dbData).eq('id', id);
    if (error) {
        console.error("Supabase Update Error:", error);
        throw error;
    }
},
    
    async getAuctionById(id) {
         const { data, error } = await supabase.from('auctions').select('*').eq('id', id).single();
         if (error) return { exists: () => false };
         return { exists: () => true, data: () => data };
    },

    async placeBid(auctionId, bidData) {
        const response = await fetch(`${PYTHON_API_URL}/auctions/${auctionId}/bid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: bidData.amount, 
                bidder_id: bidData.bidder_id // ✅ ส่ง bidder_id
            })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Bid Failed");
        }
    },
    
    async buyNow(auctionId, buyData) {
        const response = await fetch(`${PYTHON_API_URL}/auctions/${auctionId}/buy_now`, {
             method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: buyData.amount, 
                buyer_id: buyData.buyer_id // ✅ ส่ง buyer_id (DB ใช้ winner_id แต่ Python รับ buyer_id ได้)
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

// 🛠️ Helper แค่แปลง format ให้ใช้ง่าย แต่ไม่เปลี่ยนชื่อตัวแปร
function cleanSnapshot(data) {
    return { 
        docs: data.map(d => ({ data: () => d, id: d.id })), 
        empty: data.length === 0, 
        size: data.length,
        forEach: (cb) => data.map(d => ({ data: () => d, id: d.id })).forEach(cb)
    };
}
