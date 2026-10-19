// Formato de los archivos que genera pipeline/ingest.py (ver CLAUDE.md › Formato de datos).

export type Precision = "departamento" | "provincia" | "distrito" | "centro_poblado";

export interface Lugar {
  nombre: string;
  ubigeo: string; // 6 dígitos: "150000" depto, "150100" provincia, "150101" distrito
  ccpp?: string;
  precision: Precision;
  provincia: string;
  departamento: string;
  lon: number;
  lat: number;
  confianza: number;
  principal: boolean;
}

export interface Noticia {
  id: string;
  titulo: string;
  resumen: string;
  medio: string;
  medio_id: string;
  url: string;
  fecha: string; // ISO UTC
  temas: string[];
  lugares: Lugar[];
  grupo?: string;
  revisar?: boolean;
}

export interface IndiceNoticias {
  actualizado: string;
  dias: { fecha: string; n: number }[];
}

export interface EstadoMedio {
  nombre: string;
  ok: boolean;
  error: string | null;
  ultimo_ok: string | null;
  fallos_seguidos: number;
}

export interface Estado {
  ultima_ejecucion: string;
  ultima_noticia_nueva: string | null;
  nuevas: number;
  ubicadas: number;
  medios: Record<string, EstadoMedio>;
}

export interface Tema {
  clave: string;
  nombre: string;
  color: string;
}
