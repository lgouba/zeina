module github.com/zeina/hyperviseur/services/simulator

go 1.22

require (
	github.com/rs/zerolog v1.33.0
	github.com/stretchr/testify v1.9.0
	github.com/zeina/hyperviseur/packages/shared v0.0.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/eclipse/paho.mqtt.golang v1.5.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	golang.org/x/net v0.27.0 // indirect
	golang.org/x/sync v0.8.0 // indirect
	golang.org/x/sys v0.25.0 // indirect
)

replace github.com/zeina/hyperviseur/packages/shared => ../../packages/shared
