---
title: Test PlantUML
tags:
  - plantuml
date: 2026-02-07
---

# Test PlantUML - Diagramas UML

Este es un ejemplo de diagrama UML usando PlantUML. Los diagramas se renderizan como SVG escalables.

## Diagrama de Secuencia

```plantuml
@startuml
Actor Usuario
Participant "Frontend" as FE
Participant "Backend" as BE
Database "Database" as DB

Usuario -> FE: Click en botón
FE -> BE: POST /api/data
BE -> DB: SELECT * FROM users
DB --> BE: [users data]
BE --> FE: JSON response
FE --> Usuario: Mostrar datos
@enduml
```

```plantuml
@startuml
actor Foo1
boundary Foo2
control Foo3
entity Foo4
database Foo5
collections Foo6
Foo1 -> Foo2 : To boundary
Foo1 -> Foo3 : To control
Foo1 -> Foo4 : To entity
Foo1 -> Foo5 : To database
Foo1 -> Foo6 : To collections

@enduml
```

# Diagrama
```plantuml
@startuml
participant Alice
participant "The **Famous** Bob" as Bob

Alice -> Bob : hello --there--
... Some ~~long delay~~ ...
Bob -> Alice : ok
note left
  This is **bold**
  This is //italics//
  This is ""monospaced""
  This is --stroked--
  This is __underlined__
  This is ~~waved~~
end note

Alice -> Bob : A //well formatted// message
note right of Alice
 This is <back:cadetblue><size:18>displayed</size></back>
 __left of__ Alice.
end note
note left of Bob
 <u:red>This</u> is <color #118888>displayed</color>
 **<color purple>left of</color> <s:red>Alice</strike> Bob**.
end note
note over Alice, Bob
 <w:#FF33FF>This is hosted</w> by <img sourceforge.jpg>
end note
@enduml
```

## Diagrama de Clases

```plantuml
@startuml
class User {
  - id: int
  - name: string
  - email: string
  + getId()
  + setName()
}

class Post {
  - id: int
  - title: string
  - author: User
  + getAuthor()
}

User "1" -- "*" Post : creates
@enduml
```

## Características

- **Múltiples tipos**: Secuencia, clases, casos de uso, etc.
- **Sintaxis simple**: Lenguaje dedicado fácil de aprender
- **SVG escalable**: Gráficos vectoriales nítidos
- **Integración**: Directamente en markdown

## Casos de uso

PlantUML es ideal para:
- Diagramas de arquitectura
- Flujos de procesos
- Modelado de datos
- Especificaciones técnicas

fruit| price
-----|-----:
apple|2.05
pear|1.37
orange|3.09

```mermaid
sequenceDiagram
  participant Alice
  participant Bob
  Alice->>John: Hello John, how are you?
  loop Healthcheck
    John->>John: Fight against hypochondria
  end
  Note right of John: Rational thoughts <br/>prevail!
  John-->>Alice: Great!
  John->>Bob: How about you?
  Bob-->>John: Jolly good!
```

[[markmap.md]]