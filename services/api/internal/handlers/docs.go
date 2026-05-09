package handlers

import (
	_ "embed"
	"net/http"

	"github.com/labstack/echo/v4"
)

// La spec OpenAPI canonique vit à la racine du repo (/openapi/openapi.yaml).
// Le Dockerfile la copie dans ce dossier avant `go build` pour qu'elle soit
// embarquée dans le binaire — voir services/api/Dockerfile.
//
// Pour un build local (`go build ./...` hors Docker), tu peux soit :
//   - copier manuellement : `cp openapi/openapi.yaml services/api/internal/handlers/openapi.yaml`
//   - utiliser `make api-prepare` (cible Makefile à ajouter)
//
//go:embed openapi.yaml
var openAPISpec []byte

// DocsHandler sert la spec OpenAPI + une page Swagger UI minimale qui
// charge ses assets via CDN unpkg.
type DocsHandler struct{}

func NewDocsHandler() *DocsHandler { return &DocsHandler{} }

// Register expose deux routes publiques :
//
//	GET /openapi.yaml — la spec YAML brute (pour Postman, Insomnia, codegen)
//	GET /docs         — Swagger UI interactif
func (h *DocsHandler) Register(e *echo.Echo) {
	e.GET("/openapi.yaml", h.spec)
	e.GET("/docs", h.swagger)
	e.GET("/docs/", h.swagger)
}

func (h *DocsHandler) spec(c echo.Context) error {
	c.Response().Header().Set("Content-Type", "application/yaml; charset=utf-8")
	c.Response().Header().Set("Cache-Control", "no-cache")
	return c.Blob(http.StatusOK, "application/yaml", openAPISpec)
}

const swaggerHTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ZEINA — API</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #f8fafc; }
    .topbar { display: none; }
    .swagger-ui .info .title { font-family: ui-sans-serif, system-ui, sans-serif; }
    .swagger-ui .info .title small { background: #0ea5e9; }
    .swagger-ui .scheme-container { background: #ffffff; box-shadow: 0 1px 0 #e2e8f0; }
  </style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener("load", () => {
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger",
        deepLinking: true,
        persistAuthorization: true,
        tryItOutEnabled: true,
        displayRequestDuration: true,
        defaultModelsExpandDepth: 1,
        docExpansion: "list",
        filter: true,
      });
    });
  </script>
</body>
</html>`

func (h *DocsHandler) swagger(c echo.Context) error {
	return c.HTML(http.StatusOK, swaggerHTML)
}
