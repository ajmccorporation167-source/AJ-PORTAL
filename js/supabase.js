/* =========================================================================
   AJCM | RRHH CONSULTING — INTEGRACIÓN CON SUPABASE (Leads)
   -------------------------------------------------------------------------
   Envía los datos del formulario de contacto a la tabla "leads" en Supabase
   usando la API REST nativa (PostgREST), sin SDKs ni dependencias externas.

   Columnas de la tabla: nombre, empresa, correo, servicio, mensaje, creado_en
   RLS: política "Permitir inserciones publicas" ya activa (INSERT con anon key).
   ========================================================================= */
(() => {
  'use strict';

  // -----------------------------------------------------------------------
  // CONFIGURACIÓN — Claves del proyecto Supabase (anon key es pública y segura
  // para el frontend; la protección real la da Row Level Security en la tabla).
  // -----------------------------------------------------------------------
  const SUPABASE_URL  = 'https://wxxazkkxwvprsginjtjb.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4eGF6a2t4d3ZwcnNnaW5qdGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NzYwNzIsImV4cCI6MjEwNjM1MjA3Mn0.yRoDaQYTBv4jgTmMyPfpCSekalqlUGnpP7IhwfKTdZo';
  const TABLE_NAME    = 'leads';

  // -----------------------------------------------------------------------
  // UTILIDADES
  // -----------------------------------------------------------------------

  /**
   * Inserta un registro en la tabla de leads vía la API REST de Supabase.
   * Devuelve { ok: true } si fue exitoso, o { ok: false, error: string } si falló.
   */
  async function insertLead(data) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const detail = await response.text();
        console.error('Supabase insert error:', response.status, detail);
        return { ok: false, error: 'No se pudo enviar tu información. Intenta de nuevo.' };
      }

      return { ok: true };
    } catch (err) {
      console.error('Network error al enviar a Supabase:', err);
      return { ok: false, error: 'Error de conexión. Revisa tu internet e intenta otra vez.' };
    }
  }

  // -----------------------------------------------------------------------
  // CONEXIÓN CON EL FORMULARIO DEL DOM
  // -----------------------------------------------------------------------
  const leadForm   = document.getElementById('leadForm');
  const formStatus = document.getElementById('formStatus');

  if (!leadForm) return;

  leadForm.addEventListener('submit', async function handleSupabaseSubmit(e) {
    e.preventDefault();

    // Re-validar aquí por seguridad (main.js ya validó y bloqueó si hubo error)
    const nombre   = (document.getElementById('fieldName')?.value || '').trim();
    const empresa  = (document.getElementById('fieldCompany')?.value || '').trim();
    const correo   = (document.getElementById('fieldEmail')?.value || '').trim();
    const servicio = (document.getElementById('fieldService')?.value || '').trim();
    const mensaje  = (document.getElementById('fieldMessage')?.value || '').trim();

    // Validación mínima de seguridad
    if (!nombre || !empresa || !correo || !servicio) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return;

    // Desactivar botón para evitar doble envío
    const submitBtn = leadForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
    }

    if (formStatus) {
      formStatus.style.color = '';
      formStatus.textContent = '';
    }

    // Objeto para insertar — los nombres de las propiedades coinciden
    // EXACTAMENTE con las columnas de la tabla en Supabase.
    const leadData = {
      nombre:   nombre,
      empresa:  empresa,
      correo:   correo,
      servicio: servicio,
      mensaje:  mensaje || null,
      // "creado_en" se llena automáticamente con DEFAULT timezone('utc', now())
    };

    const result = await insertLead(leadData);

    if (result.ok) {
      if (formStatus) {
        formStatus.style.color = 'var(--color-gold-soft)';
        formStatus.textContent =
          'Mensaje enviado. Nuestro equipo te contactará pronto. Gracias por confiar en AJCM.';
      }
      leadForm.reset();
    } else {
      if (formStatus) {
        formStatus.style.color = '#f0a0a0';
        formStatus.textContent = result.error;
      }
    }

    // Reactivar botón
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar mensaje';
    }
  });
})();
