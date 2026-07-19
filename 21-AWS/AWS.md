# AWS Services Cheat Sheet for Microservices

| AWS Service | Purpose | Summary |
|-------------|---------|---------|
| **Amazon CloudFront** | Content Delivery Network (CDN) | Caches static and dynamic content closer to users, reducing latency and improving performance. |
| **AWS WAF** | Web Application Firewall | Protects applications from SQL Injection, XSS, bots, and other web attacks. |
| **Amazon Route 53** | DNS & Traffic Routing | Routes user requests to applications using domain names with health checks and routing policies. |
| **Amazon API Gateway** | API Management | Single entry point for REST, HTTP, and WebSocket APIs. Handles authentication, throttling, routing, and monitoring. |
| **Amazon Cognito** | Authentication & Authorization | Provides user sign-up, sign-in, JWT token generation, MFA, and social identity providers. |
| **Amazon ECS** | Container Orchestration | Fully managed container service for running Docker applications. Simpler than Kubernetes. |
| **Amazon EKS** | Managed Kubernetes | Runs Kubernetes workloads on AWS with automatic control plane management. |
| **AWS Lambda** | Serverless Compute | Executes code on demand without managing servers. Ideal for event-driven applications. |
| **AWS Fargate** | Serverless Containers | Runs containers without provisioning or managing EC2 instances. |
| **Amazon EC2** | Virtual Machines | Provides scalable virtual servers for hosting applications and services. |
| **Application Load Balancer (ALB)** | HTTP Load Balancer | Distributes HTTP/HTTPS traffic across multiple application instances. |
| **Network Load Balancer (NLB)** | TCP/UDP Load Balancer | Handles high-performance TCP, UDP, and TLS traffic with low latency. |
| **Amazon VPC** | Private Network | Creates isolated virtual networks for secure communication between AWS resources. |
| **Amazon Aurora** | Relational Database | High-performance, highly available MySQL/PostgreSQL-compatible database. |
| **Amazon RDS** | Managed Relational Database | Managed SQL databases such as MySQL, PostgreSQL, SQL Server, Oracle, and MariaDB. |
| **Amazon DynamoDB** | NoSQL Database | Serverless key-value and document database with single-digit millisecond latency. |
| **Amazon ElastiCache (Redis)** | Distributed Cache | Improves application performance by caching frequently accessed data. |
| **Amazon S3** | Object Storage | Stores files, images, videos, backups, logs, and static website content. |
| **Amazon EFS** | Shared File Storage | Managed NFS file system that can be mounted by multiple EC2 instances or containers. |
| **Amazon EBS** | Block Storage | Persistent block storage attached to EC2 instances. |
| **Amazon EventBridge** | Event Bus | Routes business events between producers and consumers using event rules. Enables Event-Driven Architecture. |
| **Amazon SNS** | Publish/Subscribe Messaging | Sends one message to multiple subscribers (fan-out) such as Lambda, SQS, email, SMS, or HTTP endpoints. |
| **Amazon SQS** | Message Queue | Reliable asynchronous message queue for decoupling microservices and background processing. |
| **Amazon MQ** | Managed Message Broker | Managed ActiveMQ and RabbitMQ service for legacy messaging systems. |
| **Amazon Kinesis** | Real-Time Data Streaming | Processes streaming data such as IoT telemetry, clickstreams, and application logs. |
| **AWS Step Functions** | Workflow Orchestration | Coordinates multiple services using visual workflows with retries, branching, and error handling. |
| **Amazon SES** | Email Service | Sends transactional, marketing, and notification emails at scale. |
| **Amazon CloudWatch** | Monitoring & Logging | Collects logs, metrics, dashboards, and alarms for AWS resources and applications. |
| **AWS X-Ray** | Distributed Tracing | Traces requests across microservices to identify latency and failures. |
| **AWS CloudTrail** | Audit Logging | Records AWS API activity for auditing, governance, and compliance. |
| **AWS Secrets Manager** | Secrets Management | Securely stores database passwords, API keys, and other application secrets. |
| **AWS Systems Manager (SSM)** | Operations Management | Automates server management, patching, remote access, and configuration. |
| **AWS IAM** | Identity & Access Management | Manages users, roles, groups, and permissions for AWS resources. |
| **AWS KMS** | Key Management Service | Creates and manages encryption keys for data protection. |
| **AWS Certificate Manager (ACM)** | SSL/TLS Certificates | Provisions and manages SSL certificates for secure HTTPS communication. |
| **Amazon ECR** | Container Registry | Stores and manages Docker container images used by ECS and EKS. |
| **Amazon Redshift** | Data Warehouse | Performs large-scale analytics and business intelligence queries. |
| **AWS Glue** | ETL Service | Extracts, transforms, and loads data for analytics and reporting. |
| **Amazon Athena** | Serverless SQL Query | Runs SQL queries directly on data stored in Amazon S3. |
| **Amazon OpenSearch Service** | Search & Analytics | Provides full-text search, log analytics, and dashboard capabilities. |
| **AWS App Mesh** | Service Mesh | Manages service-to-service communication, retries, traffic routing, and observability. |
| **AWS Bedrock** | Generative AI | Accesses foundation models to build AI-powered applications without managing infrastructure. |

---

# Most Common AWS Services Used in Microservices

- Amazon API Gateway
- Amazon Cognito
- Amazon ECS / Amazon EKS
- AWS Lambda
- Amazon Aurora
- Amazon DynamoDB
- Amazon ElastiCache (Redis)
- Amazon EventBridge
- Amazon SNS
- Amazon SQS
- Amazon CloudWatch
- AWS X-Ray
- Amazon S3
- AWS Secrets Manager
- AWS IAM
- Application Load Balancer (ALB)
- Amazon CloudFront
- AWS WAF
- Amazon ECR
- AWS Step Functions


# AWS Event-Driven Microservices Architecture

## Overview

This document describes a production-ready **AWS Event-Driven Microservices Architecture** using:

- Amazon CloudFront
- AWS WAF
- Amazon API Gateway
- Amazon Cognito
- Amazon ECS / Amazon EKS / AWS Lambda
- Amazon Aurora
- Amazon DynamoDB
- Amazon EventBridge
- Amazon SNS
- Amazon SQS
- Amazon SES
- Amazon ElastiCache
- Amazon CloudWatch
- AWS X-Ray

---

# High-Level Architecture

```mermaid
flowchart TB

    Client[Customer / Web / Mobile App]

    Client --> CloudFront[Amazon CloudFront]
    CloudFront --> WAF[AWS WAF]
    WAF --> APIGW[Amazon API Gateway]
    APIGW --> Cognito[Amazon Cognito]

    Cognito --> Compute[Amazon ECS / Amazon EKS / AWS Lambda]

    Compute --> UserService[User Service]
    Compute --> OrderService[Order Service]
    Compute --> PaymentService[Payment Service]
    Compute --> InventoryService[Inventory Service]
    Compute --> NotificationService[Notification Service]

    UserService --> UserDB[(Amazon RDS)]
    OrderService --> OrderDB[(Amazon Aurora)]
    PaymentService --> PaymentDB[(Amazon Aurora)]
    InventoryService --> InventoryDB[(Amazon DynamoDB)]
    NotificationService --> NotificationDB[(Amazon DynamoDB)]

    OrderService --> EventBridge[Amazon EventBridge]

    EventBridge --> PaymentService
    EventBridge --> InventoryService
    EventBridge --> NotificationService
    EventBridge --> AnalyticsService[Analytics Service]
    EventBridge --> LoyaltyService[Loyalty Service]
    EventBridge --> ShippingService[Shipping Service]
```

---

# Order Processing Flow

```mermaid
sequenceDiagram

    participant Customer
    participant APIGateway as API Gateway
    participant Order
    participant EventBridge
    participant Payment
    participant Inventory
    participant Notification
    participant Shipping

    Customer->>APIGateway: POST /orders

    APIGateway->>Order: Create Order

    Order->>Order: Save Order

    Order->>EventBridge: Publish OrderCreated

    EventBridge->>Payment: OrderCreated

    Payment->>Payment: Charge Card

    Payment->>EventBridge: PaymentCompleted

    EventBridge->>Inventory: PaymentCompleted

    Inventory->>Inventory: Reserve Stock

    Inventory->>EventBridge: InventoryReserved

    EventBridge->>Shipping: InventoryReserved

    Shipping->>Shipping: Create Shipment

    Shipping->>EventBridge: ShipmentCreated

    EventBridge->>Notification: ShipmentCreated

    Notification->>Customer: Email/SMS/Push
```

---

# EventBridge Routing

```mermaid
flowchart LR

    OrderService -->|OrderCreated| EventBridge

    EventBridge --> PaymentService
    EventBridge --> InventoryService
    EventBridge --> NotificationService
    EventBridge --> AnalyticsService
    EventBridge --> LoyaltyService
    EventBridge --> FraudDetection[Fraud Detection]
    EventBridge --> Recommendation[Recommendation Service]
```

---

# SNS + SQS Fan-Out Pattern

```mermaid
flowchart TB

    PaymentService

    PaymentService --> SNS[Amazon SNS Topic]

    SNS --> EmailQueue[SQS Email Queue]
    SNS --> SMSQueue[SQS SMS Queue]
    SNS --> PushQueue[SQS Push Queue]

    EmailQueue --> EmailWorker[Email Worker]
    SMSQueue --> SMSWorker[SMS Worker]
    PushQueue --> PushWorker[Push Notification Worker]

    EmailWorker --> SES[Amazon SES]

    SMSWorker --> SMSProvider[SMS Provider]

    PushWorker --> Firebase[Firebase / APNS]
```

---

# Event-Driven Architecture

```mermaid
flowchart TB

    OrderService

    OrderService -->|Publish OrderCreated| EventBridge

    EventBridge --> PaymentService

    EventBridge --> InventoryService

    EventBridge --> NotificationService

    EventBridge --> AnalyticsService

    EventBridge --> LoyaltyService

    EventBridge --> FraudDetection

    EventBridge --> RecommendationService
```

---

# Saga Pattern

```mermaid
flowchart TD

    Start([Customer Places Order])

    Start --> CreateOrder

    CreateOrder --> Payment

    Payment --> Inventory

    Inventory --> Shipping

    Shipping --> Success([Order Completed])

    Shipping -->|Failed| Refund

    Refund --> ReleaseInventory

    ReleaseInventory --> CancelOrder

    CancelOrder --> Failed([Order Cancelled])
```

---

# API Gateway Pattern

```mermaid
flowchart TB

    Client

    Client --> API[Amazon API Gateway]

    API --> UserService

    API --> OrderService

    API --> PaymentService

    API --> InventoryService

    API --> NotificationService
```

---

# Database Per Service Pattern

```mermaid
flowchart LR

    UserService --> UserDB[(Amazon RDS)]

    OrderService --> OrderDB[(Amazon Aurora)]

    PaymentService --> PaymentDB[(Amazon Aurora)]

    InventoryService --> InventoryDB[(Amazon DynamoDB)]

    NotificationService --> NotificationDB[(Amazon DynamoDB)]
```

---

# Cache-Aside Pattern

```mermaid
flowchart LR

    Client

    Client --> Application

    Application --> Redis[(Amazon ElastiCache Redis)]

    Redis -->|Cache Miss| Database[(Amazon Aurora)]

    Database --> Redis

    Redis --> Client
```

---

# Circuit Breaker Pattern

```mermaid
flowchart LR

    OrderService

    OrderService --> CircuitBreaker

    CircuitBreaker --> PaymentService

    PaymentService --> Success

    PaymentService -. Failure .-> CircuitBreaker

    CircuitBreaker -. Open Circuit .-> Fallback[Return Fallback Response]
```

---

# Retry with Exponential Backoff

```mermaid
flowchart TD

    Request

    Request --> Try1[Attempt 1]

    Try1 -->|Failed| Wait1[Wait 1 sec]

    Wait1 --> Try2[Attempt 2]

    Try2 -->|Failed| Wait2[Wait 2 sec]

    Wait2 --> Try3[Attempt 3]

    Try3 -->|Failed| Wait4[Wait 4 sec]

    Wait4 --> Try4[Attempt 4]

    Try4 --> Success
```

---

# Sidecar Pattern

```mermaid
flowchart TB

    subgraph Kubernetes Pod

        App[Application Container]

        Sidecar[Envoy / Logging / Monitoring]

    end

    App <--> Sidecar

    Sidecar --> ServiceMesh[Istio / AWS App Mesh]
```

---

# AWS Services Used

| Layer | AWS Service |
|---------|-------------|
| CDN | Amazon CloudFront |
| Security | AWS WAF |
| Authentication | Amazon Cognito |
| API Management | Amazon API Gateway |
| Compute | Amazon ECS |
| Kubernetes | Amazon EKS |
| Serverless | AWS Lambda |
| SQL Database | Amazon Aurora |
| NoSQL Database | Amazon DynamoDB |
| Cache | Amazon ElastiCache (Redis) |
| Event Bus | Amazon EventBridge |
| Notification | Amazon SNS |
| Queue | Amazon SQS |
| Email | Amazon SES |
| Monitoring | Amazon CloudWatch |
| Tracing | AWS X-Ray |
| Secrets | AWS Secrets Manager |

---

# Architecture Patterns Demonstrated

- API Gateway Pattern
- Event-Driven Architecture
- Publish-Subscribe Pattern
- SNS Fan-Out Pattern
- SQS Queue Pattern
- Saga Pattern
- Database per Service
- Circuit Breaker Pattern
- Retry Pattern
- Cache-Aside Pattern
- Sidecar Pattern
- Loose Coupling
- Independent Deployment
- Independent Scaling
- Domain-Driven Design (DDD)
- Microservices Architecture