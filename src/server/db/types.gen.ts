export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  app: {
    Tables: {
      audit_event_types: {
        Row: {
          category: string;
          description: string;
          event_type: string;
          org_optional: boolean;
          writer: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          description: string;
          event_type: string;
          org_optional?: boolean;
          writer: string;
        };
        Update: {
          category?: string;
          description?: string;
          event_type?: string;
          org_optional?: boolean;
          writer?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      aal: { Args: Record<PropertyKey, never>; Returns: string };
      accept_staff_invitation: {
        Args: {
          p_license_issuer?: string;
          p_license_number?: string;
          p_professional_title?: string;
          p_profile_id: string;
          p_request_id?: string;
          p_token_hash: string;
        };
        Returns: {
          membership_id: string;
          organization_id: string;
        }[];
      };
      approve_grant_as_owner: { Args: { p_grant_id: string }; Returns: undefined };
      approve_grant_as_psychologist: { Args: { p_grant_id: string }; Returns: undefined };
      approve_grant_as_second_admin: { Args: { p_grant_id: string }; Returns: undefined };
      audit_metadata_is_safe: { Args: { p_metadata: Json }; Returns: boolean };
      auth_user_id_by_email: { Args: { p_email: string }; Returns: string };
      auth_user_verified_email: { Args: { p_user_id: string }; Returns: string };
      branding_object_org: { Args: { p_name: string }; Returns: string };
      can_write_as_role: {
        Args: { p_org: string; p_role: Database['public']['Enums']['membership_role'] };
        Returns: boolean;
      };
      consume_rate_limit: {
        Args: { p_action: string; p_limit: number; p_window: string };
        Returns: boolean;
      };
      consume_rate_limit_key: {
        Args: { p_bucket_key: string; p_limit: number; p_window: string };
        Returns: boolean;
      };
      consume_recovery_code: {
        Args: { p_code: string };
        Returns: {
          batch_id: string;
          status: string;
        }[];
      };
      current_profile_id: { Args: Record<PropertyKey, never>; Returns: string };
      finish_recovery_reset: {
        Args: { p_factors_removed: number; p_outcome: string };
        Returns: string;
      };
      get_public_branding: {
        Args: { p_org: string };
        Returns: {
          accent_color: string;
          brand_color: string;
          child_mode_enabled: boolean;
          default_locale: string;
          display_name: string;
          favicon_file_id: string;
          functional_color: string;
          logo_file_id: string;
          logo_path: string;
          organization_id: string;
          portal_welcome_en: string;
          portal_welcome_es: string;
          secondary_color: string;
          slug: string;
        }[];
      };
      has_active_platform_grant: {
        Args: { p_org: string; p_scope: Database['public']['Enums']['grant_scope'] };
        Returns: boolean;
      };
      has_org_role: {
        Args: { p_org: string; p_role: Database['public']['Enums']['membership_role'] };
        Returns: boolean;
      };
      has_recent_mfa: { Args: { p_seconds: number }; Returns: boolean };
      insert_audit_row: {
        Args: {
          p_actor_profile_id: string;
          p_actor_roles: string[];
          p_actor_type: Database['public']['Enums']['actor_type'];
          p_event_type: string;
          p_ip: unknown;
          p_metadata: Json;
          p_organization_id: string;
          p_request_id: string;
          p_resource_id: string;
          p_resource_type: string;
          p_user_agent: string;
          p_writer: string;
        };
        Returns: string;
      };
      is_aal2: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_org_member: { Args: { p_org: string }; Returns: boolean };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      max_break_glass_duration: { Args: Record<PropertyKey, never>; Returns: string };
      my_capacities: {
        Args: Record<PropertyKey, never>;
        Returns: {
          acting_as: string;
          membership_id: string;
          membership_status: Database['public']['Enums']['membership_status'];
          org_status: Database['public']['Enums']['org_status'];
          organization_id: string;
          roles: Database['public']['Enums']['membership_role'][];
        }[];
      };
      my_membership_id: { Args: { p_org: string }; Returns: string };
      my_recovery_codes_status: {
        Args: Record<PropertyKey, never>;
        Returns: {
          batch_id: string;
          created_at: string;
          remaining: number;
          total: number;
        }[];
      };
      org_allows: { Args: { p_access: string; p_org: string }; Returns: boolean };
      org_member_directory: {
        Args: { p_org: string };
        Returns: {
          display_name: string;
          membership_id: string;
          profile_id: string;
          roles: Database['public']['Enums']['membership_role'][];
          status: Database['public']['Enums']['membership_status'];
        }[];
      };
      peek_staff_invitation: {
        Args: { p_token_hash: string };
        Returns: {
          email: string;
          existing_profile_id: string;
          expires_at: string;
          invitation_id: string;
          organization_display_name: string;
          organization_id: string;
          roles: Database['public']['Enums']['membership_role'][];
        }[];
      };
      rate_limit_window_start: { Args: { p_window: string }; Returns: string };
      replace_recovery_codes: { Args: { p_codes: string[] }; Returns: string };
      request_jwt: { Args: Record<PropertyKey, never>; Returns: Json };
      request_uid: { Args: Record<PropertyKey, never>; Returns: string };
      resolve_organization_by_host: { Args: { p_host: string }; Returns: string };
      revoke_grant: { Args: { p_grant_id: string; p_reason: string }; Returns: undefined };
      write_audit: {
        Args: {
          p_event_type: string;
          p_metadata?: Json;
          p_organization_id?: string;
          p_request_id?: string;
          p_resource_id?: string;
          p_resource_type?: string;
        };
        Returns: string;
      };
      write_system_audit: {
        Args: {
          p_actor_profile_id?: string;
          p_event_type: string;
          p_ip?: unknown;
          p_metadata?: Json;
          p_organization_id?: string;
          p_request_id?: string;
          p_resource_id?: string;
          p_resource_type?: string;
          p_user_agent?: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_logs: {
        Row: {
          actor_profile_id: string | null;
          actor_roles: string[];
          actor_type: Database['public']['Enums']['actor_type'];
          break_glass_grant_id: string | null;
          event_type: string;
          id: string;
          ip_address: unknown;
          metadata: NonNullable<Json>;
          occurred_at: string;
          organization_id: string | null;
          prev_hash: string | null;
          request_id: string | null;
          resource_id: string | null;
          resource_type: string | null;
          row_hash: string | null;
          seq: number;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          actor_profile_id?: string | null;
          actor_roles?: string[];
          actor_type: Database['public']['Enums']['actor_type'];
          break_glass_grant_id?: string | null;
          event_type: string;
          id?: string;
          ip_address?: unknown;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          organization_id?: string | null;
          prev_hash?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          row_hash?: string | null;
          seq?: never;
          user_agent?: string | null;
        };
        Update: {
          actor_profile_id?: string | null;
          actor_roles?: string[];
          actor_type?: Database['public']['Enums']['actor_type'];
          break_glass_grant_id?: string | null;
          event_type?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          organization_id?: string | null;
          prev_hash?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          row_hash?: string | null;
          seq?: never;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      idempotency_keys: {
        Row: {
          action_name: string;
          actor_profile_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          key: string;
          organization_id: string | null;
          request_hash: string;
          result_ref: Json | null;
        };
        ComputedFields: never;
        Insert: {
          action_name: string;
          actor_profile_id: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          key: string;
          organization_id?: string | null;
          request_hash: string;
          result_ref?: Json | null;
        };
        Update: {
          action_name?: string;
          actor_profile_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          key?: string;
          organization_id?: string | null;
          request_hash?: string;
          result_ref?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'idempotency_keys_actor_profile_id_fkey';
            columns: ['actor_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'idempotency_keys_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by_profile_id: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invitation_type: Database['public']['Enums']['invitation_type'];
          invited_by: string;
          organization_id: string;
          revoked_at: string | null;
          roles: Database['public']['Enums']['membership_role'][] | null;
          status: Database['public']['Enums']['invitation_status'];
          token_hash: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_by_profile_id?: string | null;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invitation_type?: Database['public']['Enums']['invitation_type'];
          invited_by: string;
          organization_id: string;
          revoked_at?: string | null;
          roles?: Database['public']['Enums']['membership_role'][] | null;
          status?: Database['public']['Enums']['invitation_status'];
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by_profile_id?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invitation_type?: Database['public']['Enums']['invitation_type'];
          invited_by?: string;
          organization_id?: string;
          revoked_at?: string | null;
          roles?: Database['public']['Enums']['membership_role'][] | null;
          status?: Database['public']['Enums']['invitation_status'];
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_accepted_by_profile_id_fkey';
            columns: ['accepted_by_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      membership_roles: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          id: string;
          membership_id: string;
          organization_id: string;
          role: Database['public']['Enums']['membership_role'];
        };
        ComputedFields: never;
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          membership_id: string;
          organization_id: string;
          role: Database['public']['Enums']['membership_role'];
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          membership_id?: string;
          organization_id?: string;
          role?: Database['public']['Enums']['membership_role'];
        };
        Relationships: [
          {
            foreignKeyName: 'membership_roles_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'membership_roles_membership_fkey';
            columns: ['organization_id', 'membership_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'membership_roles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          id: string;
          joined_at: string;
          organization_id: string;
          profile_id: string;
          removed_at: string | null;
          status: Database['public']['Enums']['membership_status'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          joined_at?: string;
          organization_id: string;
          profile_id: string;
          removed_at?: string | null;
          status?: Database['public']['Enums']['membership_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          joined_at?: string;
          organization_id?: string;
          profile_id?: string;
          removed_at?: string | null;
          status?: Database['public']['Enums']['membership_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'memberships_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      mfa_recovery_codes: {
        Row: {
          batch_id: string;
          code_hash: string;
          created_at: string;
          id: string;
          profile_id: string;
          reset_attempts: number;
          reset_status: string | null;
          revoked_at: string | null;
          used_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          batch_id: string;
          code_hash: string;
          created_at?: string;
          id?: string;
          profile_id: string;
          reset_attempts?: number;
          reset_status?: string | null;
          revoked_at?: string | null;
          used_at?: string | null;
        };
        Update: {
          batch_id?: string;
          code_hash?: string;
          created_at?: string;
          id?: string;
          profile_id?: string;
          reset_attempts?: number;
          reset_status?: string | null;
          revoked_at?: string | null;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'mfa_recovery_codes_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_branding: {
        Row: {
          accent_color: string | null;
          brand_color: string;
          child_mode_enabled: boolean;
          created_at: string;
          display_name: string;
          favicon_file_id: string | null;
          functional_color: string | null;
          logo_file_id: string | null;
          logo_path: string | null;
          organization_id: string;
          portal_welcome_en: string | null;
          portal_welcome_es: string | null;
          secondary_color: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accent_color?: string | null;
          brand_color: string;
          child_mode_enabled?: boolean;
          created_at?: string;
          display_name: string;
          favicon_file_id?: string | null;
          functional_color?: string | null;
          logo_file_id?: string | null;
          logo_path?: string | null;
          organization_id: string;
          portal_welcome_en?: string | null;
          portal_welcome_es?: string | null;
          secondary_color?: string | null;
          updated_at?: string;
        };
        Update: {
          accent_color?: string | null;
          brand_color?: string;
          child_mode_enabled?: boolean;
          created_at?: string;
          display_name?: string;
          favicon_file_id?: string | null;
          functional_color?: string | null;
          logo_file_id?: string | null;
          logo_path?: string | null;
          organization_id?: string;
          portal_welcome_en?: string | null;
          portal_welcome_es?: string | null;
          secondary_color?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_branding_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_domains: {
        Row: {
          created_at: string;
          domain_type: Database['public']['Enums']['domain_type'];
          host: string;
          id: string;
          is_primary: boolean;
          organization_id: string;
          updated_at: string;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          domain_type?: Database['public']['Enums']['domain_type'];
          host: string;
          id?: string;
          is_primary?: boolean;
          organization_id: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string;
          domain_type?: Database['public']['Enums']['domain_type'];
          host?: string;
          id?: string;
          is_primary?: boolean;
          organization_id?: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_domains_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          country_code: string;
          created_at: string;
          default_locale: string;
          display_name: string;
          id: string;
          legal_name: string;
          slug: string;
          status: Database['public']['Enums']['org_status'];
          tax_id: string | null;
          time_zone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          country_code?: string;
          created_at?: string;
          default_locale?: string;
          display_name: string;
          id?: string;
          legal_name: string;
          slug: string;
          status?: Database['public']['Enums']['org_status'];
          tax_id?: string | null;
          time_zone?: string;
          updated_at?: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          default_locale?: string;
          display_name?: string;
          id?: string;
          legal_name?: string;
          slug?: string;
          status?: Database['public']['Enums']['org_status'];
          tax_id?: string | null;
          time_zone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_access_grants: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          object_scope: Json | null;
          organization_id: string;
          owner_approved_at: string | null;
          owner_approved_by_profile_id: string | null;
          patient_id: string | null;
          platform_admin_profile_id: string;
          psychologist_approval_required: boolean;
          psychologist_approved_at: string | null;
          psychologist_approved_by_membership_id: string | null;
          reason: string;
          report_sent_at: string | null;
          requested_duration: string;
          revoked_at: string | null;
          revoked_by_profile_id: string | null;
          scope: Database['public']['Enums']['grant_scope'];
          second_approved_at: string | null;
          second_approver_profile_id: string | null;
          starts_at: string | null;
          status: Database['public']['Enums']['grant_status'];
          ticket_reference: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          object_scope?: Json | null;
          organization_id: string;
          owner_approved_at?: string | null;
          owner_approved_by_profile_id?: string | null;
          patient_id?: string | null;
          platform_admin_profile_id: string;
          psychologist_approval_required?: boolean;
          psychologist_approved_at?: string | null;
          psychologist_approved_by_membership_id?: string | null;
          reason: string;
          report_sent_at?: string | null;
          requested_duration?: string;
          revoked_at?: string | null;
          revoked_by_profile_id?: string | null;
          scope: Database['public']['Enums']['grant_scope'];
          second_approved_at?: string | null;
          second_approver_profile_id?: string | null;
          starts_at?: string | null;
          status?: Database['public']['Enums']['grant_status'];
          ticket_reference: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          object_scope?: Json | null;
          organization_id?: string;
          owner_approved_at?: string | null;
          owner_approved_by_profile_id?: string | null;
          patient_id?: string | null;
          platform_admin_profile_id?: string;
          psychologist_approval_required?: boolean;
          psychologist_approved_at?: string | null;
          psychologist_approved_by_membership_id?: string | null;
          reason?: string;
          report_sent_at?: string | null;
          requested_duration?: string;
          revoked_at?: string | null;
          revoked_by_profile_id?: string | null;
          scope?: Database['public']['Enums']['grant_scope'];
          second_approved_at?: string | null;
          second_approver_profile_id?: string | null;
          starts_at?: string | null;
          status?: Database['public']['Enums']['grant_status'];
          ticket_reference?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_access_grants_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_access_grants_owner_approved_by_profile_id_fkey';
            columns: ['owner_approved_by_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_access_grants_platform_admin_profile_id_fkey';
            columns: ['platform_admin_profile_id'];
            isOneToOne: false;
            referencedRelation: 'platform_admins';
            referencedColumns: ['profile_id'];
          },
          {
            foreignKeyName: 'platform_access_grants_psy_membership_fkey';
            columns: ['organization_id', 'psychologist_approved_by_membership_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'platform_access_grants_revoked_by_profile_id_fkey';
            columns: ['revoked_by_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_access_grants_second_approver_profile_id_fkey';
            columns: ['second_approver_profile_id'];
            isOneToOne: false;
            referencedRelation: 'platform_admins';
            referencedColumns: ['profile_id'];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          granted_at: string;
          granted_by: string | null;
          profile_id: string;
          revoked_at: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          profile_id: string;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          profile_id?: string;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_admins_granted_by_fkey';
            columns: ['granted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_admins_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      professional_profiles: {
        Row: {
          created_at: string;
          id: string;
          license_issuer: string;
          license_number: string;
          membership_id: string;
          organization_id: string;
          professional_title: string;
          signature_file_id: string | null;
          specialties: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          license_issuer: string;
          license_number: string;
          membership_id: string;
          organization_id: string;
          professional_title: string;
          signature_file_id?: string | null;
          specialties?: string[];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          license_issuer?: string;
          license_number?: string;
          membership_id?: string;
          organization_id?: string;
          professional_title?: string;
          signature_file_id?: string | null;
          specialties?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'professional_profiles_membership_fkey';
            columns: ['organization_id', 'membership_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'professional_profiles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          last_seen_at: string | null;
          locale: string | null;
          time_zone: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string;
          id: string;
          last_seen_at?: string | null;
          locale?: string | null;
          time_zone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          last_seen_at?: string | null;
          locale?: string | null;
          time_zone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      rate_limit_counters: {
        Row: {
          bucket_key: string;
          count: number;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          bucket_key: string;
          count?: number;
          window_start: string;
        };
        Update: {
          bucket_key?: string;
          count?: number;
          window_start?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      actor_type: 'user' | 'system' | 'platform_admin' | 'break_glass';
      domain_type: 'subdomain' | 'custom';
      grant_scope: 'org_support_non_clinical' | 'clinical_read_break_glass';
      grant_status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
      invitation_status: 'pending' | 'accepted' | 'revoked' | 'expired';
      invitation_type: 'staff' | 'patient' | 'guardian';
      membership_role: 'organization_owner' | 'psychologist';
      membership_status: 'active' | 'suspended' | 'removed';
      org_status: 'active' | 'read_only' | 'suspended' | 'closed';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  app: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type: ['user', 'system', 'platform_admin', 'break_glass'],
      domain_type: ['subdomain', 'custom'],
      grant_scope: ['org_support_non_clinical', 'clinical_read_break_glass'],
      grant_status: ['pending', 'approved', 'rejected', 'revoked', 'expired'],
      invitation_status: ['pending', 'accepted', 'revoked', 'expired'],
      invitation_type: ['staff', 'patient', 'guardian'],
      membership_role: ['organization_owner', 'psychologist'],
      membership_status: ['active', 'suspended', 'removed'],
      org_status: ['active', 'read_only', 'suspended', 'closed'],
    },
  },
} as const;
