import {
  AuditLogEntry,
  Customer,
  OrderPriority,
  ServiceOrder,
  ServiceStatus,
  ServiceType,
  StorageQuotaStats,
  TechnicianConfig,
  UserProfile,
  UserRole,
} from "@/types/pelletGalicia";

export class CloudApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new CloudApiError("Sesión caducada", 401, "UNAUTHORIZED");
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new CloudApiError(
      data?.error || `Error ${res.status}`,
      res.status,
      data?.code
    );
  }

  return data as T;
}

export const cloudApi = {
  async getMe(): Promise<{ user: { id: string; email?: string }; profile: UserProfile }> {
    return requestJson("/api/auth/me", { cache: "no-store" });
  },

  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
  },

  async getCustomers(): Promise<Customer[]> {
    const res = await requestJson<{ customers: Customer[] }>("/api/customers", {
      cache: "no-store",
    });
    return res.customers;
  },

  async saveCustomer(
    payload: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Promise<Customer> {
    const res = await requestJson<{ customer: Customer }>("/api/customers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.customer;
  },

  async deleteCustomer(id: string): Promise<void> {
    await requestJson(`/api/customers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async getOrders(): Promise<ServiceOrder[]> {
    const res = await requestJson<{ orders: ServiceOrder[] }>("/api/orders", {
      cache: "no-store",
    });
    return res.orders;
  },

  async createOrder(
    customerId: string,
    payload: {
      assignedTechId?: string | null;
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
    }
  ): Promise<ServiceOrder> {
    const res = await requestJson<{ order: ServiceOrder }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        ...payload,
      }),
    });
    return res.order;
  },

  async updateOrder(
    orderId: string,
    updates: {
      assignedTechId?: string | null;
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
      status?: ServiceStatus;
    }
  ): Promise<ServiceOrder> {
    const res = await requestJson<{ order: ServiceOrder }>(
      `/api/orders/${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
    return res.order;
  },

  async deleteOrder(orderId: string): Promise<void> {
    await requestJson(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    });
  },

  async batchUpdateOrderStatus(
    orderIds: string[],
    status: "En Ruta" | "Completado"
  ): Promise<void> {
    await requestJson("/api/orders/batch-status", {
      method: "POST",
      body: JSON.stringify({ orderIds, status }),
    });
  },

  async getConfig(): Promise<TechnicianConfig> {
    const res = await requestJson<{ config: TechnicianConfig }>("/api/config", {
      cache: "no-store",
    });
    return res.config;
  },

  async saveConfig(
    updates: Partial<TechnicianConfig> & { clearGoogleMapsApiKey?: boolean }
  ): Promise<TechnicianConfig> {
    const res = await requestJson<{ config: TechnicianConfig }>("/api/config", {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    return res.config;
  },

  async getStorageStats(): Promise<StorageQuotaStats> {
    const res = await requestJson<{ stats: StorageQuotaStats }>(
      "/api/storage/stats",
      { cache: "no-store" }
    );
    return res.stats;
  },

  async pruneStorage(params?: {
    auditOlderThanDays?: number;
    keepLatestAuditRows?: number;
    archiveCompletedOlderThanDays?: number;
  }): Promise<{
    deletedLogs: number;
    deletedOrders: number;
    stats: StorageQuotaStats;
  }> {
    return requestJson("/api/storage/prune", {
      method: "POST",
      body: JSON.stringify(params || {}),
    });
  },

  async getAuditLogs(): Promise<AuditLogEntry[]> {
    const res = await requestJson<{ logs: AuditLogEntry[] }>(
      "/api/audit-logs",
      { cache: "no-store" }
    );
    return res.logs;
  },

  async getUsers(): Promise<{
    users: UserProfile[];
    canManageAuthUsers: boolean;
  }> {
    return requestJson("/api/admin/users", { cache: "no-store" });
  },

  async createUser(payload: {
    email: string;
    fullName: string;
    password: string;
    role: UserRole;
  }): Promise<UserProfile> {
    const res = await requestJson<{ user: UserProfile }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.user;
  },

  async updateUser(
    id: string,
    updates: {
      isActive?: boolean;
      role?: UserRole;
      fullName?: string;
      newPassword?: string;
    }
  ): Promise<UserProfile> {
    const res = await requestJson<{ user: UserProfile }>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
    return res.user;
  },

  async migrateLocalData(payload: {
    customers: Customer[];
    orders: ServiceOrder[];
    config?: TechnicianConfig;
  }): Promise<{ importedCustomers: number; importedOrders: number }> {
    return requestJson("/api/migrate-local", {
      method: "POST",
      body: JSON.stringify({
        customers: payload.customers.map((c) => ({
          id: c.id,
          legacyId: c.id,
          name: c.name,
          village: c.village,
          phone: c.phone || "",
          coordinates: c.coordinates,
          equipmentInfo: c.equipmentInfo || "",
          internalNotes: c.internalNotes || "",
          lastServiceType: c.lastServiceType,
          lastInterventionMinutes: c.lastInterventionMinutes,
          lastServiceDate: c.lastServiceDate,
          totalServicesHistory: c.totalServicesHistory,
          totalBilledHistoryEur: c.totalBilledHistoryEur,
        })),
        orders: payload.orders.map((o) => ({
          id: o.id,
          customerId: o.customerId,
          customerName: o.customer?.name,
          customerPhone: o.customer?.phone,
          serviceType: o.serviceType,
          priority: o.priority,
          equipmentInfo: o.equipmentInfo || "",
          estimatedMinutes: o.estimatedMinutes,
          actualMinutes: o.actualMinutes,
          estimatedPriceEur: o.estimatedPriceEur || 0,
          collectedPriceEur: o.collectedPriceEur,
          technicalNotes: o.technicalNotes || "",
          resolutionNote: o.resolutionNote || "",
          status: o.status,
          createdAt: o.createdAt,
          completedAt: o.completedAt,
        })),
        config: payload.config,
      }),
    });
  },

  // Endpoints del Técnico
  async getTechOrders(): Promise<{
    orders: ServiceOrder[];
    config: TechnicianConfig | null;
    profile: UserProfile;
  }> {
    return requestJson("/api/tech/orders", { cache: "no-store" });
  },

  async completeTechOrder(
    orderId: string,
    payload: {
      actualMinutes: number;
      collectedPriceEur: number;
      resolutionNote?: string;
      serviceType?: ServiceType;
    }
  ): Promise<void> {
    await requestJson(
      `/api/tech/orders/${encodeURIComponent(orderId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },
};
