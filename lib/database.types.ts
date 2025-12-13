/**
 * VeryTask - Database Type Definitions
 * 
 * Auto-generated types for Supabase tables
 * Regenerate with: npx supabase gen types typescript --project-id YOUR_PROJECT_ID
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      tasks: {
        Row: {
          id: number;
          poster_address: string;
          worker_address: string | null;
          tx_hash: string | null;
          title: string;
          description: string | null;
          category: string | null;
          amount_wei: string;
          amount_display: number | null;
          token_symbol: string;
          location: unknown; // PostGIS GEOGRAPHY type
          latitude: number | null;
          longitude: number | null;
          address_line: string | null;
          city: string | null;
          postal_code: string | null;
          country_code: string;
          status: 'open' | 'in_progress' | 'submitted' | 'completed' | 'disputed' | 'cancelled';
          is_boosted: boolean;
          boosted_at: string | null;
          ipfs_proof_hash: string | null;
          created_at: string;
          updated_at: string;
          deadline: string | null;
          completed_at: string | null;
        };
        Insert: {
          id: number;
          poster_address: string;
          worker_address?: string | null;
          tx_hash?: string | null;
          title: string;
          description?: string | null;
          category?: string | null;
          amount_wei: string;
          amount_display?: number | null;
          token_symbol?: string;
          latitude?: number | null;
          longitude?: number | null;
          address_line?: string | null;
          city?: string | null;
          postal_code?: string | null;
          country_code?: string;
          status?: 'open' | 'in_progress' | 'submitted' | 'completed' | 'disputed' | 'cancelled';
          is_boosted?: boolean;
          boosted_at?: string | null;
          ipfs_proof_hash?: string | null;
          deadline?: string | null;
        };
        Update: {
          id?: number;
          poster_address?: string;
          worker_address?: string | null;
          tx_hash?: string | null;
          title?: string;
          description?: string | null;
          category?: string | null;
          amount_wei?: string;
          amount_display?: number | null;
          token_symbol?: string;
          latitude?: number | null;
          longitude?: number | null;
          address_line?: string | null;
          city?: string | null;
          postal_code?: string | null;
          country_code?: string;
          status?: 'open' | 'in_progress' | 'submitted' | 'completed' | 'disputed' | 'cancelled';
          is_boosted?: boolean;
          boosted_at?: string | null;
          ipfs_proof_hash?: string | null;
          deadline?: string | null;
          completed_at?: string | null;
        };
      };
    };
    Functions: {
      get_nearby_tasks: {
        Args: {
          user_lat: number;
          user_long: number;
          radius_meters?: number;
          task_status?: string | null;
          limit_count?: number;
        };
        Returns: {
          id: number;
          poster_address: string;
          worker_address: string | null;
          title: string;
          description: string | null;
          category: string | null;
          amount_display: number | null;
          token_symbol: string;
          latitude: number | null;
          longitude: number | null;
          address_line: string | null;
          city: string | null;
          status: string;
          is_boosted: boolean;
          created_at: string;
          deadline: string | null;
          distance_meters: number;
        }[];
      };
    };
  };
}

// Convenience type exports
export type Task = Database['public']['Tables']['tasks']['Row'];
export type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
export type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
export type TaskStatus = Task['status'];

// Nearby task response type (with distance)
export type NearbyTask = Database['public']['Functions']['get_nearby_tasks']['Returns'][number];
