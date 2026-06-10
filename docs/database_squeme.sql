create table documents_debit_credit_notes
(
    id                           int auto_increment
        primary key,
    document_type                enum ('CREDITO', 'DEBITO')          not null,
    stakeholder_id               int                                 null,
    related_bill_document_number varchar(250)                        not null,
    related_bill_uuid            varchar(250)                        not null,
    related_bill_serie           varchar(250)                        not null,
    adjustment_reason            varchar(250)                        not null,
    response_pdf                 longtext                            null,
    request                      longtext                            not null,
    error                        longtext                            null,
    response_json                longtext                            null,
    serie                        varchar(250)                        null,
    uuid                         varchar(250)                        null,
    document_number              varchar(250)                        null,
    created_at                   timestamp default CURRENT_TIMESTAMP not null,
    created_by                   varchar(250)                        not null,
    request_detail               longtext                            null
);

create table log_documents
(
    id            int auto_increment,
    response_pdf  longtext     null,
    request       longtext     not null,
    error         longtext     null,
    response_json longtext     null,
    create_at     datetime     not null,
    update_at     datetime     null,
    document_id   varchar(250) not null,
    created_by    varchar(250) null,
    serie         varchar(250) null,
    uuid          varchar(250) null,
    constraint log_documents_UN
        unique (id)
);

create index log_documents_document_id_IDX
    on log_documents (document_id);

create table migrations
(
    id     int auto_increment
        primary key,
    name   varchar(255) not null,
    run_on datetime     not null
);

create table payment_methods
(
    name        varchar(25)  not null
        primary key,
    description varchar(255) null
);

create table roles
(
    id          int auto_increment
        primary key,
    name        varchar(50)          not null,
    permissions json                 not null,
    is_active   tinyint(1) default 1 not null
);

create table taxes
(
    id          int auto_increment
        primary key,
    name        varchar(255)  not null,
    description varchar(255)  null,
    fee         decimal(5, 2) not null,
    constraint taxes_name_unique
        unique (name),
    constraint taxes_fee_check
        check (`fee` between 0.00 and 100.00)
);

create table users
(
    id               int auto_increment
        primary key,
    full_name        varchar(150)         not null,
    password         text                 not null,
    email            varchar(50)          not null,
    sales_commission decimal(5, 2)        null,
    rol_id           int                  not null,
    permissions      json                 not null,
    is_active        tinyint(1) default 1 not null,
    constraint users_roles_id_fk
        foreign key (rol_id) references roles (id)
);

create table operations
(
    id             int auto_increment
        primary key,
    operation_type enum ('INVENTORY_ADJUSTMENT', 'SELL', 'PURCHASE', 'RENT', 'REPAIR') not null,
    created_at     timestamp default CURRENT_TIMESTAMP                                 not null,
    created_by     int                                                                 not null,
    constraint operations_created_by_fk
        foreign key (created_by) references users (id)
);

create table inventory_adjustments
(
    id                int auto_increment
        primary key,
    operation_id      int                                 null,
    adjustment_reason text                                null,
    created_at        timestamp default CURRENT_TIMESTAMP not null,
    created_by        int                                 not null,
    constraint inventory_adjustments_created_by_fk
        foreign key (created_by) references users (id),
    constraint inventory_adjustments_operation_id_fk
        foreign key (operation_id) references operations (id)
);

create table products
(
    id                    int auto_increment
        primary key,
    product_type          enum ('SERVICE', 'PRODUCT')                                      not null,
    product_category      enum ('EQUIPMENT', 'PART')                                       null,
    status                enum ('ACTIVE', 'INACTIVE', 'BLOCKED') default 'ACTIVE'          not null,
    description           varchar(255)                                                     not null,
    code                  varchar(50)                                                      not null,
    serial_number         varchar(50)                                                      null,
    unit_price            double                                                           null,
    tax_id                int                                                              null,
    stock                 int                                    default 0                 not null,
    inventory_unit_value  double                                 default 0                 not null,
    inventory_total_value double                                 default 0                 not null,
    image_url             text                                                             null,
    created_at            timestamp                              default CURRENT_TIMESTAMP not null,
    created_by            int                                                              not null,
    updated_at            timestamp                                                        null on update CURRENT_TIMESTAMP,
    updated_by            int                                                              null,
    constraint products_code_product_type_unique
        unique (code, product_type, product_category),
    constraint products_created_by_fk
        foreign key (created_by) references users (id),
    constraint products_tax_id_fk
        foreign key (tax_id) references taxes (id),
    constraint products_updated_by_fk
        foreign key (updated_by) references users (id),
    constraint products_product_category_check
        check ((`product_type` <> _utf8mb4\'PRODUCT\') or (`product_category` is not null))
);

create table inventory_adjustments_products
(
    id                      int auto_increment
        primary key,
    inventory_adjustment_id int not null,
    product_id              int not null,
    preview_stock           int not null,
    next_stock              int not null,
    constraint inventory_adjustment_product_id_fk
        foreign key (product_id) references products (id),
    constraint inventory_adjustments_inventory_adjustment_id_fk
        foreign key (inventory_adjustment_id) references inventory_adjustments (id)
            on update cascade on delete cascade
);

create table inventory_movements
(
    id                   int auto_increment
        primary key,
    operation_id         int                                                                    not null,
    product_id           int                                                                    not null,
    movement_type        enum ('IN', 'OUT')                                                     not null,
    quantity             int                                                  default 0         not null,
    unit_cost            double                                               default 0         not null,
    total_cost           double                                               default 0         not null,
    inventory_quantity   int                                                  default 0         not null,
    inventory_unit_cost  double                                               default 0         not null,
    inventory_total_cost double                                               default 0         not null,
    status               enum ('PENDING', 'PARTIAL', 'APPROVED', 'CANCELLED') default 'PENDING' not null,
    constraint inventory_movements_operation_id_fk
        foreign key (operation_id) references operations (id),
    constraint inventory_movements_product_id_fk
        foreign key (product_id) references products (id),
    constraint inventory_movements_unit_cost_check
        check ((`movement_type` <> _utf8mb3\'IN\') or (`unit_cost` is not null))
);

create table inventory_movements_details
(
    id                    int auto_increment
        primary key,
    inventory_movement_id int                                 not null,
    quantity              int                                 not null,
    storage_location      varchar(255)                        null,
    comments              text                                null,
    created_at            timestamp default CURRENT_TIMESTAMP not null,
    created_by            int                                 not null,
    constraint inventory_movements_details_created_by_fk
        foreign key (created_by) references users (id),
    constraint inventory_movements_details_inventory_movement_id_fk
        foreign key (inventory_movement_id) references inventory_movements (id)
);

create table stakeholders
(
    id                int auto_increment
        primary key,
    stakeholder_type  enum ('CLIENT_INDIVIDUAL', 'CLIENT_COMPANY', 'PROVIDER')         not null,
    status            enum ('ACTIVE', 'INACTIVE', 'BLOCKED') default 'ACTIVE'          not null,
    name              varchar(100)                                                     not null,
    address           varchar(100)                                                     not null,
    nit               varchar(11)                                                      not null,
    email             varchar(100)                                                     null,
    phone             varchar(20)                                                      null,
    alternative_phone varchar(20)                                                      null,
    business_man      varchar(100)                                                     null,
    payments_man      varchar(100)                                                     null,
    block_reason      text                                                             null,
    credit_limit      decimal(11, 2)                                                   null,
    total_credit      decimal(11, 2)                                                   null,
    paid_credit       decimal(11, 2)                                                   null,
    created_at        timestamp                              default CURRENT_TIMESTAMP not null,
    created_by        int                                                              not null,
    updated_at        timestamp                                                        null on update CURRENT_TIMESTAMP,
    updated_by        int                                                              null,
    constraint stakeholders_nit_stakeholder_type_unique
        unique (nit, stakeholder_type),
    constraint stakeholders_created_by_fk
        foreign key (created_by) references users (id),
    constraint stakeholders_updated_by_fk
        foreign key (updated_by) references users (id),
    constraint stakeholders_updated_by_check
        check ((`updated_at` is null) or (`updated_by` is not null))
);

create table projects
(
    id             int auto_increment
        primary key,
    stakeholder_id int                                  not null,
    name           varchar(255)                         null,
    start_date     timestamp                            null,
    end_date       timestamp                            null,
    is_active      tinyint(1) default 1                 not null,
    created_at     timestamp  default CURRENT_TIMESTAMP not null,
    created_by     int                                  not null,
    updated_at     timestamp                            null on update CURRENT_TIMESTAMP,
    updated_by     int                                  null,
    constraint projects_created_by_fk
        foreign key (created_by) references users (id),
    constraint projects_stakeholder_id_fk
        foreign key (stakeholder_id) references stakeholders (id)
            on update cascade on delete cascade,
    constraint projects_updated_by_fk
        foreign key (updated_by) references users (id)
);

create table documents
(
    id                           int auto_increment
        primary key,
    document_type                enum ('SELL_PRE_INVOICE', 'RENT_PRE_INVOICE', 'SELL_INVOICE', 'RENT_INVOICE', 'PURCHASE_ORDER', 'REPAIR_ORDER') not null,
    stakeholder_id               int                                                                                                             null,
    operation_id                 int                                                                                                             null,
    project_id                   int                                                                                                             null,
    product_id                   int                                                                                                             null,
    related_internal_document_id int                                                                                                             null,
    related_external_document_id varchar(50)                                                                                                     null,
    status                       enum ('PENDING', 'APPROVED', 'CANCELLED') default 'PENDING'                                                     not null,
    comments                     text                                                                                                            null,
    received_by                  varchar(255)                                                                                                    null,
    dispatched_by                varchar(255)                                                                                                    null,
    start_date                   timestamp                                                                                                       null,
    end_date                     timestamp                                                                                                       null,
    cancel_reason                text                                                                                                            null,
    subtotal_amount              double                                                                                                          null,
    sales_commission_amount      double                                                                                                          null,
    total_discount_amount        double                                                                                                          null,
    total_tax_amount             double                                                                                                          null,
    total_amount                 double                                                                                                          null,
    description                  text                                                                                                            null,
    payment_method               varchar(25)                                                                                                     null,
    credit_days                  int                                                                                                             null,
    credit_status                enum ('UNPAID', 'PAID', 'DEFAULT')                                                                              null,
    paid_credit_amount           double                                    default 0                                                             null,
    credit_paid_date             timestamp                                                                                                       null,
    credit_due_date              timestamp                                                                                                       null,
    created_at                   timestamp                                 default CURRENT_TIMESTAMP                                             not null,
    created_by                   int                                                                                                             not null,
    updated_at                   timestamp                                                                                                       null on update CURRENT_TIMESTAMP,
    updated_by                   int                                                                                                             null,
    serie                        varchar(500)                                                                                                    null,
    document_number              varchar(500)                                                                                                    null,
    uuid                         varchar(500)                                                                                                    null,
    constraint documents_created_by_fk
        foreign key (created_by) references users (id),
    constraint documents_operation_id_fk
        foreign key (operation_id) references operations (id),
    constraint documents_payment_method_fk
        foreign key (payment_method) references payment_methods (name),
    constraint documents_product_id_fk
        foreign key (product_id) references products (id),
    constraint documents_project_id_fk
        foreign key (project_id) references projects (id)
            on update cascade on delete cascade,
    constraint documents_related_internal_document_id_fk
        foreign key (related_internal_document_id) references documents (id)
            on update cascade on delete cascade,
    constraint documents_stakeholder_id_fk
        foreign key (stakeholder_id) references stakeholders (id),
    constraint documents_updated_by_fk
        foreign key (updated_by) references users (id),
    constraint documents_credit_status_check
        check ((`credit_days` is null) or (`credit_status` is not null)),
    constraint documents_product_id_check
        check ((`document_type` <> _utf8mb4\'REPAIR_ORDER\') or (`product_id` is not null)),
	constraint documents_stakeholder_id_check
		check ((`document_type` = _utf8mb4\'REPAIR_ORDER\') or (`stakeholder_id` is not null)),
	constraint documents_subtotal_amount_check
		check (((`document_type` <> _utf8mb4\'RENT_INVOICE\') and (`document_type` <> _utf8mb4\'RENT_PRE_INVOICE\') and (`document_type` <> _utf8mb4\'SELL_INVOICE\') and (`document_type` <> _utf8mb4\'SELL_PRE_INVOICE\')) or (`subtotal_amount` is not null)),
	constraint documents_total_amount_check
		check (((`document_type` <> _utf8mb4\'RENT_INVOICE\') and (`document_type` <> _utf8mb4\'SELL_INVOICE\')) or (`total_amount` is not null))
);

create table documents_products
(
    id                   int auto_increment
        primary key,
    service_type         enum ('PART', 'EQUIPMENT', 'SERVICE') null,
    document_id          int                                   not null,
    product_id           int                                   not null,
    product_price        double default 0                      null,
    product_quantity     int                                   not null,
    tax_fee              decimal(5, 2)                         not null,
    unit_tax_amount      double                                not null,
    discount_percentage  decimal(5, 2)                         null,
    unit_discount_amount double                                null,
    parent_product_id    int                                   null,
    constraint documents_products_document_id_fk
        foreign key (document_id) references documents (id)
            on update cascade on delete cascade,
    constraint documents_products_product_id_fk
        foreign key (product_id) references products (id),
    constraint documents_products_discount_percentage_check
        check (`discount_percentage` between 0.00 and 100.00),
    constraint documents_products_tax_fee_check
        check (`tax_fee` between 0.00 and 100.00)
);

create table manual_payments
(
    id             int auto_increment
        primary key,
    total_amount   double                                                       null,
    status         enum ('UNPAID', 'PAID', 'DEFAULT') default 'UNPAID'          null,
    created_at     timestamp                          default CURRENT_TIMESTAMP null,
    stakeholder_id int                                                          null,
    project_id     int                                                          null,
    constraint manual_payments_id_uindex
        unique (id),
    constraint manual_payments_project_fk
        foreign key (project_id) references projects (id),
    constraint manual_payments_stakeholder_fk
        foreign key (stakeholder_id) references stakeholders (id)
);

create index manual_payments_project_index
    on manual_payments (project_id);

create index manual_payments_stakeholder_index
    on manual_payments (stakeholder_id);

create table manual_payments_detail
(
    id                        int auto_increment
        primary key,
    payment_method            varchar(25)                          not null,
    payment_amount            double                               not null,
    payment_date              date                                 not null,
    is_deleted                tinyint(1) default 0                 not null,
    created_at                timestamp  default CURRENT_TIMESTAMP not null,
    created_by                int                                  not null,
    description               text                                 null,
    attachment_url            text                                 null comment 'URL publica del comprobante adjunto (S3)',
    manual_payment            int                                  null,
    related_external_document varchar(500)                         null,
    constraint manual_payments_fk
        foreign key (manual_payment) references manual_payments (id)
            on delete cascade,
    constraint manual_payments_payment_method_fk
        foreign key (payment_method) references payment_methods (name)
);

create index manual_payments_id_fk
    on manual_payments_detail (manual_payment);

create table payments
(
    id                        int auto_increment
        primary key,
    document_id               int                                  not null,
    payment_method            varchar(25)                          not null,
    payment_amount            double                               not null,
    payment_date              timestamp                            not null,
    related_external_document varchar(100)                         null,
    is_deleted                tinyint(1) default 0                 not null,
    created_at                timestamp  default CURRENT_TIMESTAMP not null,
    created_by                int                                  not null,
    description               text                                 null,
    attachment_url            text                                 null comment 'URL publica del comprobante adjunto (S3)',
    constraint payments_document_id_fk
        foreign key (document_id) references documents (id),
    constraint payments_payment_method_fk
        foreign key (payment_method) references payment_methods (name)
);

