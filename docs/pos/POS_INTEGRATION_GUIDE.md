# ARK POS - Integration Guide with Arkiv OS

## Overview

This document describes how ARK POS integrates with existing Arkiv OS modules (HRD & Purchasing).

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    TALENTPOOL ECOSYSTEM                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐  │
│  │  HRD Module  │      │ Purchasing   │      │   POS    │  │
│  │              │      │   Module     │      │  Module  │  │
│  │  employees   │      │ raw_materials│      │  products│  │
│  │  roles       │      │ suppliers    │      │  orders  │  │
│  │  attendance  │      │ purchase_ord │      │  recipes │──┼──┐
│  └──────┬───────┘      └──────┬───────┘      └────┬─────┘  │  │
│         │                     │                    │        │  │
│         │ FK: cashier_id      │ FK: raw_material_id│        │  │
│         │ FK: server_id       │                    │        │  │
│         │ FK: created_by      │                    │        │  │
│         ▼                     ▼                    │        │  │
│  ┌─────────────────────────────────────────────────┴────┐   │  │
│  │              SHARED DATABASE (PostgreSQL)              │   │  │
│  │                                                      │   │  │
│  │  hrd.employees ◄─── pos_orders.cashier_id           │   │  │
│  │  hrd.employees ◄─── pos_orders.server_id            │   │  │
│  │  hrd.employees ◄─── pos_cashier_shifts.cashier_id   │   │  │
│  │                                                      │   │  │
│  │  purchasing.raw_materials ◄─── pos_recipes.raw_mat. │   │  │
│  │                                                      │   │  │
│  └──────────────────────────────────────────────────────┘   │  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔗 HRD Module Integration

### Tables Involved

**Source (HRD):**
```sql
hrd.employees
├── id uuid PRIMARY KEY
├── name varchar(100)
├── email varchar(100)
├── phone varchar(20)
├── role_id uuid
├── department_id uuid
├── position varchar(50)
├── join_date date
├── is_active boolean
└── ...
```

**Target (POS):**
```sql
pos_orders
├── cashier_id uuid REFERENCES hrd.employees(id)
└── server_id uuid REFERENCES hrd.employees(id)

pos_cashier_shifts
└── cashier_id uuid REFERENCES hrd.employees(id)

pos_order_status_history
└── changed_by uuid REFERENCES hrd.employees(id)
```

### Integration Points

#### 1. **Employee Lookup API**

```typescript
// GET /api/hrd/employees?search=xxx&role=cashier
export async function getEmployees(params: {
  search?: string;
  role?: string;
  is_active?: boolean;
}): Promise<Employee[]> {
  const response = await fetch(`/api/hrd/employees?${new URLSearchParams(params)}`);
  return response.json();
}
```

**Usage in POS:**
- Cashier selection during shift open
- Server assignment for orders
- Staff lookup in reports

#### 2. **Role-Based Access Control**

```typescript
// POS Permissions based on HRD roles
const POS_PERMISSIONS = {
  pos_admin: ['all'],
  pos_manager: ['orders:create', 'orders:void', 'shift:close', 'discount:approve'],
  pos_cashier: ['orders:create', 'shift:open', 'shift:close'],
  pos_kitchen: ['kds:view', 'kds:update'],
  pos_server: ['orders:create', 'orders:view'],
};

// Check permission
function can(user: Employee, action: string): boolean {
  const permissions = POS_PERMISSIONS[user.role_id as keyof typeof POS_PERMISSIONS];
  return permissions?.includes(action) || permissions?.includes('all');
}
```

#### 3. **Auto-Disable on Employee Resign**

```sql
-- Trigger: When employee.is_active = false, revoke POS access
CREATE OR REPLACE FUNCTION hrd_employee_deactivate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = false THEN
    -- Log active shifts for closure
    UPDATE pos_cashier_shifts
    SET status = 'suspended', notes = 'Employee deactivated'
    WHERE cashier_id = NEW.id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_deactivate_trigger
  AFTER UPDATE ON hrd.employees
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION hrd_employee_deactivate();
```

### Data Flow

```
Employee Login (HRD Auth)
         ↓
  POS Dashboard Load
         ↓
  Fetch Employee Data
         ↓
  Determine POS Role
         ↓
  Show/Hide Features (RBAC)
```

---

## 📦 Purchasing Module Integration

### Tables Involved

**Source (Purchasing):**
```sql
purchasing.raw_materials
├── id uuid PRIMARY KEY
├── name varchar(200)
├── sku varchar(50) UNIQUE
├── category_id uuid
├── unit_of_measure varchar(20)  -- kg, liter, pcs, etc.
├── current_stock decimal(12,4)
├── min_stock decimal(12,4)
├── max_stock decimal(12,4)
├── cost_price decimal(12,2)
├── supplier_id uuid
├── is_active boolean
└── ...

purchasing.purchase_orders
├── id uuid PRIMARY KEY
├── po_number varchar(50)
├── supplier_id uuid
├── status varchar(20)
├── total decimal(12,2)
└── ...

purchasing.grn (Goods Received Note)
├── id uuid PRIMARY KEY
├── po_id uuid
├── items jsonb  -- [{raw_material_id, qty_received}]
└── ...
```

**Target (POS):**
```sql
pos_products
├── id uuid PRIMARY KEY
└── inventory_tracking boolean

pos_recipes
├── product_id uuid REFERENCES pos_products(id)
├── raw_material_id uuid REFERENCES purchasing.raw_materials(id)
├── quantity_per_unit decimal(12,4)
└── unit_of_measure varchar(20)
```

### Integration Points

#### 1. **Recipe Builder (BOM - Bill of Materials)**

```typescript
// When creating a product, define its recipe
interface RecipeItem {
  raw_material_id: string;
  quantity_per_unit: number;
  unit_of_measure: string;
  waste_percentage?: number;
}

// POST /api/pos/products/:id/recipe
async function createProductRecipe(
  productId: string,
  recipe: RecipeItem[]
): Promise<void> {
  await fetch(`/api/pos/products/${productId}/recipe`, {
    method: 'POST',
    body: JSON.stringify({ recipe }),
  });
}
```

**Example:**
```
Product: Kopi Gula Aren (1 cup)
Recipe:
  - Coffee Beans: 20 gram
  - Gula Aren Syrup: 30 ml
  - Water: 150 ml
  - Ice Cub: 100 gram
  - Cup + Lid: 1 pcs
```

#### 2. **Real-time Inventory Deduction**

```typescript
// On order checkout, deduct raw materials
async function deductInventoryOnCheckout(order: Order): Promise<void> {
  for (const item of order.items) {
    // Get recipe for this product
    const recipe = await getProductRecipe(item.product_id);
    
    for (const ingredient of recipe) {
      const quantityToDeduct = 
        ingredient.quantity_per_unit * item.quantity;
      
      // Deduct from raw_materials.current_stock
      await fetch(`/api/purchasing/raw-materials/${ingredient.raw_material_id}/deduct`, {
        method: 'POST',
        body: JSON.stringify({
          quantity: quantityToDeduct,
          reason: 'POS Order',
          order_id: order.id,
        }),
      });
    }
  }
}
```

**SQL Implementation:**
```sql
-- Function to deduct inventory
CREATE OR REPLACE FUNCTION pos_deduct_inventory(
  p_order_id uuid,
  p_cashier_id uuid
)
RETURNS void AS $$
DECLARE
  order_item RECORD;
  recipe_item RECORD;
  v_deduct_qty decimal(12,4);
BEGIN
  -- Loop through order items
  FOR order_item IN 
    SELECT * FROM pos_order_items WHERE order_id = p_order_id
  LOOP
    -- Loop through recipe ingredients
    FOR recipe_item IN 
      SELECT * FROM pos_recipes 
      WHERE product_id = order_item.product_id AND is_active = true
    LOOP
      v_deduct_qty := recipe_item.quantity_per_unit * order_item.quantity;
      
      -- Deduct from raw_materials (allows negative)
      UPDATE purchasing.raw_materials
      SET current_stock = current_stock - v_deduct_qty,
          updated_at = now()
      WHERE id = recipe_item.raw_material_id;
      
      -- Log inventory movement
      INSERT INTO purchasing.inventory_movements (
        raw_material_id, movement_type, quantity, 
        reference_type, reference_id, created_by
      ) VALUES (
        recipe_item.raw_material_id, 'OUT', -v_deduct_qty,
        'POS_ORDER', p_order_id, p_cashier_id
      );
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

#### 3. **Low Stock Alerts → PO Suggestions**

```sql
-- Trigger: When stock goes below minimum
CREATE OR REPLACE FUNCTION purchasing_low_stock_alert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_stock < NEW.min_stock THEN
    -- Insert notification
    INSERT INTO notifications (
      user_id, type, title, message, data
    )
    SELECT 
      id,
      'LOW_STOCK',
      'Low Stock Alert: ' || NEW.name,
      'Current stock (' || NEW.current_stock || ') is below minimum (' || NEW.min_stock || ')',
      jsonb_build_object(
        'raw_material_id', NEW.id,
        'current_stock', NEW.current_stock,
        'min_stock', NEW.min_stock,
        'suggested_order_qty', NEW.max_stock - NEW.current_stock
      )
    FROM hrd.employees
    WHERE role_id = (SELECT id FROM hrd.roles WHERE name = 'purchasing_manager');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER low_stock_alert_trigger
  AFTER UPDATE ON purchasing.raw_materials
  FOR EACH ROW
  WHEN (NEW.current_stock < NEW.min_stock AND OLD.current_stock >= OLD.min_stock)
  EXECUTE FUNCTION purchasing_low_stock_alert();
```

**UI Notification:**
```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Low Stock Alert                                      │
├─────────────────────────────────────────────────────────┤
│ Coffee Beans                                            │
│ Current: 2.5 kg | Minimum: 5 kg | Maximum: 20 kg       │
│                                                         │
│ Suggested Order: 17.5 kg                                │
│                                                         │
│ [Create Purchase Order] [Dismiss]                       │
└─────────────────────────────────────────────────────────┘
```

#### 4. **Cost Tracking (HPP Calculation)**

```typescript
// Calculate product cost from recipe
async function calculateProductCost(productId: string): Promise<number> {
  const recipe = await getProductRecipe(productId);
  
  let totalCost = 0;
  for (const ingredient of recipe) {
    const rawMaterial = await getRawMaterial(ingredient.raw_material_id);
    const cost = rawMaterial.cost_price * ingredient.quantity_per_unit;
    const waste = cost * (ingredient.waste_percentage / 100);
    totalCost += cost + waste;
  }
  
  return totalCost;
}

// Update product cost_price
await updateProduct(productId, { cost_price: totalCost });
```

**Usage:**
- Profit margin calculation
- Menu pricing strategy
- Daily/weekly profit reports

### Data Flow

```
POS Order Checkout
         ↓
  Get Order Items
         ↓
  For Each Item:
    - Get Recipe
    - For Each Ingredient:
      - Deduct raw_materials.current_stock
      - Log inventory_movement
      - Check if stock < min_stock
         ↓
  If Low Stock:
    - Send notification to purchasing manager
    - Suggest PO creation
         ↓
  Update Product Dashboard
```

---

## 🔐 Security & Permissions

### Row Level Security (RLS)

```sql
-- POS can read HRD employees (active only)
CREATE POLICY "POS read employees"
  ON hrd.employees FOR SELECT
  TO authenticated
  USING (is_active = true);

-- POS can read raw_materials
CREATE POLICY "POS read raw_materials"
  ON purchasing.raw_materials FOR SELECT
  TO authenticated
  USING (true);

-- POS can update raw_materials.current_stock (via function)
CREATE POLICY "POS update raw_materials stock"
  ON purchasing.raw_materials FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- POS cannot delete or insert raw_materials
CREATE POLICY "POS no delete raw_materials"
  ON purchasing.raw_materials FOR DELETE
  TO authenticated
  USING (false);
```

### API Authentication

```typescript
// All POS API calls require authentication
// Employee role is extracted from JWT token

// Middleware: /api/pos/*
export async function middleware(req: Request) {
  const token = req.headers.get('Authorization');
  const employee = await verifyEmployeeToken(token);
  
  if (!employee || !employee.is_active) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Attach employee to request
  req.employee = employee;
  return NextResponse.next();
}
```

---

## 📊 Reporting & Analytics

### Cross-Module Reports

#### 1. **Daily Sales vs Inventory Usage**
```sql
SELECT 
  DATE(o.ordered_at) as date,
  SUM(o.total_amount) as total_sales,
  COUNT(DISTINCT o.id) as total_orders,
  COUNT(DISTINCT o.cashier_id) as active_cashiers,
  jsonb_agg(DISTINCT jsonb_build_object(
    'raw_material', rm.name,
    'quantity_used', SUM(im.quantity),
    'unit', rm.unit_of_measure
  )) as inventory_usage
FROM pos_orders o
JOIN pos_order_items oi ON oi.order_id = o.id
JOIN pos_recipes r ON r.product_id = oi.product_id
JOIN purchasing.raw_materials rm ON rm.id = r.raw_material_id
JOIN purchasing.inventory_movements im ON im.reference_id = o.id::text
WHERE o.status = 'completed'
  AND o.ordered_at >= now() - interval '30 days'
GROUP BY DATE(o.ordered_at)
ORDER BY date DESC;
```

#### 2. **Employee Performance**
```sql
SELECT 
  e.name as employee_name,
  e.position,
  COUNT(DISTINCT o.id) as total_orders,
  SUM(o.total_amount) as total_sales,
  AVG(o.total_amount) as avg_order_value,
  COUNT(DISTINCT DATE(o.ordered_at)) as active_days
FROM pos_orders o
JOIN hrd.employees e ON e.id = o.cashier_id
WHERE o.status = 'completed'
  AND o.ordered_at >= now() - interval '30 days'
GROUP BY e.id, e.name, e.position
ORDER BY total_sales DESC;
```

#### 3. **Product Profitability**
```sql
SELECT 
  p.name as product_name,
  COUNT(oi.id) as times_sold,
  SUM(oi.total_amount) as total_revenue,
  AVG(p.base_price) as avg_selling_price,
  AVG(p.cost_price) as avg_cost_price,
  AVG(p.base_price - p.cost_price) as avg_profit_margin,
  SUM(oi.total_amount - (p.cost_price * oi.quantity)) as total_profit
FROM pos_products p
JOIN pos_order_items oi ON oi.product_id = p.id
JOIN pos_orders o ON o.id = oi.order_id
WHERE o.status = 'completed'
  AND o.ordered_at >= now() - interval '30 days'
GROUP BY p.id, p.name
ORDER BY total_profit DESC;
```

---

## 🧪 Testing Strategy

### Integration Tests

```typescript
// Test: HRD Integration
describe('HRD Integration', () => {
  it('should fetch active employees for cashier selection', async () => {
    const employees = await getEmployees({ is_active: true });
    expect(employees.length).toBeGreaterThan(0);
    expect(employees.every(e => e.is_active)).toBe(true);
  });

  it('should block order creation with deactivated cashier', async () => {
    const deactivatedEmployee = await createEmployee({ is_active: false });
    
    await expect(createOrder({ cashier_id: deactivatedEmployee.id }))
      .rejects.toThrow('Cashier is not active');
  });
});

// Test: Purchasing Integration
describe('Purchasing Integration', () => {
  it('should deduct raw materials on order checkout', async () => {
    const product = await createProductWithRecipe();
    const initialStock = await getRawMaterialStock(product.recipe[0].raw_material_id);
    
    const order = await createOrder({ items: [{ product_id: product.id, quantity: 2 }] });
    await checkoutOrder(order.id);
    
    const expectedDeduction = product.recipe[0].quantity_per_unit * 2;
    const newStock = await getRawMaterialStock(product.recipe[0].raw_material_id);
    
    expect(newStock).toBe(initialStock - expectedDeduction);
  });

  it('should trigger low stock alert when stock < minimum', async () => {
    const rawMaterial = await createRawMaterial({ 
      current_stock: 10, 
      min_stock: 5 
    });
    
    // Create order that will deduct stock below minimum
    await createOrderWithProductThatUsesRawMaterial(rawMaterial.id, { quantity: 10 });
    
    const notifications = await getNotifications({ type: 'LOW_STOCK' });
    expect(notifications.length).toBeGreaterThan(0);
  });
});
```

---

## 📝 Migration Checklist

### Pre-Migration
- [ ] Backup existing HRD and Purchasing data
- [ ] Verify `hrd.employees` table exists
- [ ] Verify `purchasing.raw_materials` table exists
- [ ] Document current foreign key constraints

### Migration Execution
- [ ] Run `001_pos_core_schema.sql` migration
- [ ] Verify foreign keys created successfully
- [ ] Test RLS policies
- [ ] Run integration tests

### Post-Migration
- [ ] Verify employee lookup works in POS UI
- [ ] Test order creation with employee references
- [ ] Test inventory deduction on checkout
- [ ] Verify low stock alerts trigger correctly
- [ ] Check cross-module reports

---

## 🐛 Troubleshooting

### Common Issues

#### 1. **"Foreign key violation on cashier_id"**
**Cause**: Employee ID doesn't exist in `hrd.employees`  
**Solution**: Ensure cashier_id references valid employee

```sql
-- Check if employee exists
SELECT * FROM hrd.employees WHERE id = 'xxx';

-- Fix: Use correct employee ID
UPDATE pos_orders 
SET cashier_id = 'valid-employee-uuid' 
WHERE cashier_id = 'invalid-uuid';
```

#### 2. **"Raw material not found for recipe"**
**Cause**: Recipe references non-existent raw_material_id  
**Solution**: Verify raw material exists or update recipe

```sql
-- Check raw material
SELECT * FROM purchasing.raw_materials WHERE id = 'xxx';

-- Update recipe with correct raw_material_id
UPDATE pos_recipes 
SET raw_material_id = 'correct-uuid' 
WHERE raw_material_id = 'invalid-uuid';
```

#### 3. **"Inventory not deducting on checkout"**
**Cause**: `inventory_tracking` flag not enabled or recipe missing  
**Solution**: Check product settings and recipe

```sql
-- Verify product has inventory_tracking enabled
SELECT inventory_tracking FROM pos_products WHERE id = 'xxx';

-- Verify recipe exists
SELECT * FROM pos_recipes WHERE product_id = 'xxx';

-- Enable inventory tracking
UPDATE pos_products 
SET inventory_tracking = true 
WHERE id = 'xxx';
```

---

*Last updated: 2026-04-26*  
*Version: 1.0*
