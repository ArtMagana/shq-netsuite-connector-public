# CSRF Threat Model

## Modelo actual de autenticacion

- El frontend es una SPA con `HashRouter`.
- Las rutas mutantes internas usan `X-Internal-Api-Key`.
- No existe una sesion browser basada en cookies para autenticacion de usuario final.

## Observacion importante

CSRF clasico aplica cuando el navegador adjunta credenciales automaticamente, normalmente cookies.

Hoy el control dominante no es una cookie, sino un header explicito.

## Riesgo real actual

### Riesgo bajo-medio de CSRF clasico

- un sitio externo no puede abusar facil de una cookie que aqui no existe

### Riesgo mas relevante hoy

- exponer `VITE_INTERNAL_API_KEY` en frontend no constituye auth fuerte
- si esa llave vive en un navegador, el problema principal es de modelo de autenticacion, no solo de CSRF

## Endpoints mutantes relevantes

- rutas protegidas por `requireInternalApiKey`
- varias mutaciones en `bancos`
- mutaciones en `inventario`
- mutaciones SAT/NetSuite de `app.ts`

## Cuando CSRF si aplicaria

- si se introducen cookies de sesion reales
- si una futura auth enterprise usa browser sessions
- si se agrega un panel multiusuario con login web

## Patron recomendado si alguna vez aplica

1. `GET /api/csrf-token`
2. respuesta con token
3. cliente envia `X-CSRF-Token`
4. backend valida token + origen

Opciones:

- double-submit cookie
- token por sesion

## Endpoints que probablemente quedarian fuera

- scripts internos no browser
- webhooks
- integraciones CLI

## Riesgo de romper APIs internas

- meter CSRF global hoy podria bloquear consumers que no usan browser
- tambien puede mezclar preocupaciones de auth real con auth interna de laboratorio

## Recomendacion

- no implementar CSRF en esta rama
- primero definir autenticacion real futura
- solo despues decidir si CSRF aplica a toda la app o a un subconjunto browser-only
