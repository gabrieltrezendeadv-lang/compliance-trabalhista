// Tipos gerados manualmente para o schema do Supabase.
// Em produção, usar `npx supabase gen types typescript` para gerar automaticamente.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          legal_name: string | null;
          trade_name: string | null;
          document_type: string;
          document_number: string | null;
          email: string | null;
          phone: string | null;
          address: Json;
          settings: Json;
          plan: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          legal_name?: string | null;
          trade_name?: string | null;
          document_type?: string;
          document_number?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: Json;
          settings?: Json;
          plan?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          legal_name?: string | null;
          trade_name?: string | null;
          document_type?: string;
          document_number?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: Json;
          settings?: Json;
          plan?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          phone: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          full_name?: string;
          email: string;
          phone?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          full_name?: string;
          email?: string;
          phone?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      organization_members: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: "owner" | "admin" | "manager" | "collaborator" | "investigator" | "auditor";
          invited_by: string | null;
          invited_at: string | null;
          accepted_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          role?: "owner" | "admin" | "manager" | "collaborator" | "investigator" | "auditor";
          invited_by?: string | null;
          invited_at?: string | null;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          role?: "owner" | "admin" | "manager" | "collaborator" | "investigator" | "auditor";
          invited_at?: string | null;
          accepted_at?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      establishments: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          code: string | null;
          document_number: string | null;
          is_headquarters: boolean;
          phone: string | null;
          email: string | null;
          address: Json;
          employee_count: number;
          cnae_code: string | null;
          risk_grade: number | null;
          active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          code?: string | null;
          document_number?: string | null;
          is_headquarters?: boolean;
          phone?: string | null;
          email?: string | null;
          address?: Json;
          employee_count?: number;
          cnae_code?: string | null;
          risk_grade?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          code?: string | null;
          document_number?: string | null;
          is_headquarters?: boolean;
          phone?: string | null;
          email?: string | null;
          address?: Json;
          employee_count?: number;
          cnae_code?: string | null;
          risk_grade?: number | null;
          active?: boolean;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      departments: {
        Row: {
          id: string;
          tenant_id: string;
          establishment_id: string;
          name: string;
          code: string | null;
          parent_department_id: string | null;
          manager_user_id: string | null;
          employee_count: number;
          active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          establishment_id: string;
          name: string;
          code?: string | null;
          parent_department_id?: string | null;
          manager_user_id?: string | null;
          employee_count?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          code?: string | null;
          establishment_id?: string;
          parent_department_id?: string | null;
          manager_user_id?: string | null;
          employee_count?: number;
          active?: boolean;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
    };
    Functions: {
      fn_create_organization: {
        Args: {
          p_name: string;
          p_slug: string;
          p_document_number?: string;
          p_legal_name?: string;
          p_trade_name?: string;
        };
        Returns: string;
      };
      fn_tenant_ids_for_user: {
        Args: Record<string, never>;
        Returns: string[];
      };
      fn_user_has_role: {
        Args: {
          p_tenant_id: string;
          p_role: string;
        };
        Returns: boolean;
      };
      fn_user_has_any_role: {
        Args: {
          p_tenant_id: string;
          p_roles: string[];
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "owner" | "admin" | "manager" | "collaborator" | "investigator" | "auditor";
    };
  };
}
