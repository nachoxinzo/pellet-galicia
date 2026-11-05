import { openDB, DBSchema, IDBPDatabase } from "idb";
import CryptoJS from "crypto-js";
import {
  VanClient,
  VanOrder,
  VanSettings,
  PELLET_VAN_RULES,
  EncryptedBackupPayload,
} from "@/types/pelletVan";

const DB_NAME = "PelletVanLocalDB_v1";
const DB_VERSION = 1;

interface PelletVanDBSchema extends DBSchema {
  clients: {
    key: string;
    value: VanClient;
    indexes: { "by-name": string };
  };
  orders: {
    key: string;
    value: VanOrder;
    indexes: { "by-status": string };
  };
  settings: {
    key: string;
    value: VanSettings;
  };
}

export const DEFAULT_VAN_SETTINGS: VanSettings = {
  vanCapacitySacks: PELLET_VAN_RULES.DEFAULT_VAN_CAPACITY_SACKS,
  maxWeightKg:
    PELLET_VAN_RULES.DEFAULT_VAN_CAPACITY_SACKS *
    PELLET_VAN_RULES.SACK_WEIGHT_KG,
  warehouseName: "Base Rural PelletVan Ourense",
  warehouseAddress: "Polígono Industrial San Cibrao das Viñas, Parcela 14, Ourense",
  warehouseCoordinates: { lat: 42.2982, lng: -7.8185 },
  adminPin: PELLET_VAN_RULES.DEFAULT_ADMIN_PIN,
};

// Datos semilla iniciales en aldeas y concellos de Galicia
const INITIAL_SEED_CLIENTS: VanClient[] = [
  {
    id: "cli-van-1",
    name: "Casa Manolo (Lugar de Vilar)",
    phone: "654 321 987",
    address: "Lugar de Vilar s/n, Parroquia de San Martiño, Allariz (Ourense)",
    coordinates: { lat: 42.1912, lng: -7.8012 },
    internalNotes: "Entrar despacio por la pista de tierra. Dejar los sacos junto al hórreo.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cli-van-2",
    name: "Granja O Curral (Maceda)",
    phone: "611 223 344",
    address: "Aldea de Calvelo, Maceda (Ourense)",
    coordinates: { lat: 42.2705, lng: -7.6521 },
    internalNotes: "Portón metálico verde. Descargar en nave de calderas.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cli-van-3",
    name: "Casa Rural Ribeira Sacra",
    phone: "677 889 900",
    address: "Lugar de Alberguería, Parada de Sil (Ribeira Sacra)",
    coordinates: { lat: 42.3831, lng: -7.5714 },
    internalNotes: "Bajada con curva cerrada antes del mirador. Llamar 15 min antes.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cli-van-4",
    name: "Pensión Os Castros (Castro Caldelas)",
    phone: "622 445 566",
    address: "Calle de la Fortaleza 4, Castro Caldelas (Ourense)",
    coordinates: { lat: 42.3752, lng: -7.4168 },
    internalNotes: "Descargar antes de las 11h en portalón de piedra.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const INITIAL_SEED_ORDERS: VanOrder[] = [
  {
    id: "ord-van-1",
    clientId: "cli-van-1",
    client: INITIAL_SEED_CLIENTS[0],
    sacks: 30,
    totalWeightKg: 30 * 15, // 450 kg
    orderNotes: "Cobro por Bizum ya recibido.",
    createdAt: new Date().toISOString(),
    status: "Pendiente",
  },
  {
    id: "ord-van-2",
    clientId: "cli-van-2",
    client: INITIAL_SEED_CLIENTS[1],
    sacks: 35,
    totalWeightKg: 35 * 15, // 525 kg
    orderNotes: "Cobrar en efectivo en mano.",
    createdAt: new Date().toISOString(),
    status: "Pendiente",
  },
  {
    id: "ord-van-3",
    clientId: "cli-van-3",
    client: INITIAL_SEED_CLIENTS[2],
    sacks: 25,
    totalWeightKg: 25 * 15, // 375 kg
    orderNotes: "Dejar albarán en buzón.",
    createdAt: new Date().toISOString(),
    status: "Pendiente",
  },
  {
    id: "ord-van-4",
    clientId: "cli-van-4",
    client: INITIAL_SEED_CLIENTS[3],
    sacks: 20,
    totalWeightKg: 20 * 15, // 300 kg
    orderNotes: "Factura simplificada.",
    createdAt: new Date().toISOString(),
    status: "Pendiente",
  },
];

class PelletVanIndexedDbService {
  private dbPromise: Promise<IDBPDatabase<PelletVanDBSchema>> | null = null;

  private getDB(): Promise<IDBPDatabase<PelletVanDBSchema>> {
    if (typeof window === "undefined") {
      return Promise.reject(new Error("IndexedDB solo está disponible en el navegador."));
    }

    if (!this.dbPromise) {
      this.dbPromise = openDB<PelletVanDBSchema>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("clients")) {
            const clientStore = db.createObjectStore("clients", {
              keyPath: "id",
            });
            clientStore.createIndex("by-name", "name");
          }
          if (!db.objectStoreNames.contains("orders")) {
            const orderStore = db.createObjectStore("orders", {
              keyPath: "id",
            });
            orderStore.createIndex("by-status", "status");
          }
          if (!db.objectStoreNames.contains("settings")) {
            db.createObjectStore("settings");
          }
        },
      });
    }

    return this.dbPromise;
  }

  /**
   * Inicializa la base de datos con datos semilla si es la primera vez que se abre.
   */
  async ensureInitialized(): Promise<void> {
    const db = await this.getDB();
    const currentSettings = await db.get("settings", "config");
    if (!currentSettings) {
      await db.put("settings", DEFAULT_VAN_SETTINGS, "config");
      for (const client of INITIAL_SEED_CLIENTS) {
        await db.put("clients", client);
      }
      for (const order of INITIAL_SEED_ORDERS) {
        await db.put("orders", order);
      }
    }
  }

  // --- CLIENTES (IndexedDB) ---
  async getClients(): Promise<VanClient[]> {
    await this.ensureInitialized();
    const db = await this.getDB();
    return db.getAll("clients");
  }

  async saveClient(
    clientData: Omit<VanClient, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Promise<VanClient> {
    const db = await this.getDB();
    const now = new Date().toISOString();
    const id = clientData.id || `cli-${Date.now()}`;
    const existing = await db.get("clients", id);

    const client: VanClient = {
      id,
      name: clientData.name.trim(),
      phone: clientData.phone.trim(),
      address: clientData.address.trim(),
      coordinates: clientData.coordinates,
      internalNotes: clientData.internalNotes?.trim() || "",
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await db.put("clients", client);
    return client;
  }

  async deleteClient(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete("clients", id);
  }

  // --- PEDIDOS (IndexedDB) ---
  async getOrders(): Promise<VanOrder[]> {
    await this.ensureInitialized();
    const db = await this.getDB();
    const orders = await db.getAll("orders");
    return orders.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async saveOrder(
    clientId: string,
    sacks: number,
    orderNotes?: string,
    existingOrderId?: string
  ): Promise<VanOrder> {
    const db = await this.getDB();
    const client = await db.get("clients", clientId);
    if (!client) throw new Error("Cliente no encontrado en la base de datos local.");

    const safeSacks = Math.max(1, Math.floor(Number(sacks) || 1));
    const totalWeightKg = safeSacks * PELLET_VAN_RULES.SACK_WEIGHT_KG;
    const now = new Date().toISOString();
    const id = existingOrderId || `ord-van-${Date.now().toString().slice(-6)}`;

    const order: VanOrder = {
      id,
      clientId: client.id,
      client,
      sacks: safeSacks,
      totalWeightKg,
      orderNotes: orderNotes?.trim() || "",
      createdAt: now,
      status: "Pendiente",
    };

    await db.put("orders", order);
    return order;
  }

  async updateOrderStatus(id: string, status: VanOrder["status"]): Promise<void> {
    const db = await this.getDB();
    const order = await db.get("orders", id);
    if (order) {
      order.status = status;
      await db.put("orders", order);
    }
  }

  async deleteOrder(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete("orders", id);
  }

  // --- CONFIGURACIÓN DEL FURGÓN Y ALMACÉN ---
  async getSettings(): Promise<VanSettings> {
    await this.ensureInitialized();
    const db = await this.getDB();
    const settings = await db.get("settings", "config");
    return settings || DEFAULT_VAN_SETTINGS;
  }

  async saveSettings(settings: Partial<VanSettings>): Promise<VanSettings> {
    const db = await this.getDB();
    const current = await this.getSettings();
    const capacity = settings.vanCapacitySacks ?? current.vanCapacitySacks;

    const updated: VanSettings = {
      ...current,
      ...settings,
      vanCapacitySacks: capacity,
      maxWeightKg: capacity * PELLET_VAN_RULES.SACK_WEIGHT_KG,
    };

    await db.put("settings", updated, "config");
    return updated;
  }

  // --- EXPORTACIÓN E IMPORTACIÓN DE BACKUP CIFRADO (AES) ---
  /**
   * Genera un JSON cifrado con AES-256 de toda la base de datos local.
   */
  async exportEncryptedBackup(secretPassword: string): Promise<string> {
    const clients = await this.getClients();
    const orders = await this.getOrders();
    const settings = await this.getSettings();

    const plainData = JSON.stringify({
      clients,
      orders,
      settings,
      exportedAt: new Date().toISOString(),
    });

    const encryptedData = CryptoJS.AES.encrypt(plainData, secretPassword).toString();

    const payload: EncryptedBackupPayload = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      encryptedData,
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Descifra y restaura un archivo JSON de backup.
   */
  async importEncryptedBackup(jsonContent: string, secretPassword: string): Promise<boolean> {
    try {
      const payload: EncryptedBackupPayload = JSON.parse(jsonContent);
      if (!payload.encryptedData) throw new Error("Formato de backup inválido.");

      const bytes = CryptoJS.AES.decrypt(payload.encryptedData, secretPassword);
      const decryptedText = bytes.toString(CryptoJS.enc.Utf8);

      if (!decryptedText) {
        throw new Error("Contraseña incorrecta o archivo dañado.");
      }

      const data = JSON.parse(decryptedText);
      const db = await this.getDB();

      // Restaurar clientes
      if (Array.isArray(data.clients)) {
        const txClients = db.transaction("clients", "readwrite");
        await txClients.store.clear();
        for (const c of data.clients) {
          await txClients.store.put(c);
        }
        await txClients.done;
      }

      // Restaurar pedidos
      if (Array.isArray(data.orders)) {
        const txOrders = db.transaction("orders", "readwrite");
        await txOrders.store.clear();
        for (const o of data.orders) {
          await txOrders.store.put(o);
        }
        await txOrders.done;
      }

      // Restaurar configuración
      if (data.settings) {
        await db.put("settings", data.settings, "config");
      }

      return true;
    } catch (err) {
      console.error("Error importando backup cifrado:", err);
      throw err;
    }
  }

  /**
   * Borra completamente los datos locales (Reset total).
   */
  async clearAllLocalData(): Promise<void> {
    const db = await this.getDB();
    await db.clear("clients");
    await db.clear("orders");
    await db.put("settings", DEFAULT_VAN_SETTINGS, "config");
  }
}

export const pelletVanStorage = new PelletVanIndexedDbService();
