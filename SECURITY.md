# Security Documentation

## Recent Security Fixes

This document outlines the critical security improvements made to the woven_erp_app application.

### 1. Credentials Management

#### **FIXED**: Hardcoded Database Credentials
- **Issue**: Database credentials were hardcoded in `server.js`
- **Fix**: Moved all credentials to environment variables (`.env` file)
- **Impact**: Prevents credential exposure in version control

#### **FIXED**: Hardcoded Session Secret
- **Issue**: Session secret was hardcoded in source code
- **Fix**: Session secret now loaded from `SESSION_SECRET` environment variable
- **Impact**: Prevents session hijacking if repository is compromised

### 2. Authentication & Authorization

#### **ADDED**: Authentication Middleware
- `requireAuth`: Ensures user is logged in
- `requireAdmin`: Ensures user has admin privileges
- Applied to all sensitive endpoints

#### **SECURED**: Debug Endpoints
- All `/api/debug/*` endpoints now require authentication
- In production mode, debug endpoints require admin role
- Prevents unauthorized access to sensitive system information

### 3. Input Validation & Sanitization

#### **ADDED**: Input Validation Middleware
- Sanitizes all request bodies and query parameters
- Removes potentially malicious script tags
- Applied globally to all API routes
- Prevents XSS (Cross-Site Scripting) attacks

### 4. Cookie Security

#### **ENHANCED**: Session Cookie Configuration
- **Production Mode**:
  - `secure: true` (requires HTTPS)
  - `sameSite: 'strict'` (prevents CSRF attacks)
- **Development Mode**:
  - `secure: false` (allows HTTP testing)
  - `sameSite: 'lax'`
- `httpOnly: true` (prevents JavaScript access to cookies)

### 5. CORS Configuration

#### **IMPROVED**: Environment-Based CORS
- Production: Only allows configured domains
- Development: Includes localhost for testing
- Prevents unauthorized cross-origin requests
- Configure allowed origins via `CORS_ORIGIN` environment variable

### 6. Environment Configuration

#### **ADDED**: Environment Variable Validation
- Server validates required environment variables on startup
- Fails fast with clear error messages if configuration is missing
- Prevents running with insecure defaults

### 7. Git Security

#### **REMOVED**: Sensitive Files from Version Control
- Removed `node_modules` from git tracking
- Removed large binary files (`.zip`)
- Updated `.gitignore` to prevent future commits of:
  - Environment files (`.env`)
  - Log files (`*.log`)
  - Temporary files
  - Archive files

### 8. Logging & Monitoring

#### **IMPROVED**: Production Logging
- Sensitive session logs only in development mode
- Error stack traces hidden in production
- Reduces information disclosure

## Configuration Guide

### Required Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Copy the example file
cp .env.example .env

# Edit with your actual values
nano .env
```

### Generating a Secure Session Secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and set it as `SESSION_SECRET` in your `.env` file.

### Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Generate and set a new `SESSION_SECRET`
- [ ] Set `COOKIE_SECURE=true` (requires HTTPS)
- [ ] Set `COOKIE_SAME_SITE=strict`
- [ ] Configure `CORS_ORIGIN` with your domain(s)
- [ ] Use strong database credentials
- [ ] Enable HTTPS/SSL on your server
- [ ] Set appropriate `DB_CONNECTION_LIMIT` for your traffic
- [ ] Review and restrict admin user access

### Security Best Practices

1. **Never commit `.env` files to version control**
2. **Rotate session secrets regularly**
3. **Use strong, unique database passwords**
4. **Enable HTTPS in production**
5. **Regularly update dependencies**: `npm audit fix`
6. **Monitor application logs for suspicious activity**
7. **Backup database regularly**
8. **Limit admin user accounts**

### Remaining Security Considerations

1. **Rate Limiting**: Consider adding rate limiting to prevent brute force attacks
2. **SQL Injection**: While using parameterized queries, review all database operations
3. **File Upload Security**: If file uploads are added, validate file types and sizes
4. **Password Policy**: Consider enforcing strong password requirements
5. **2FA**: Consider implementing two-factor authentication for admin accounts
6. **Audit Logging**: Consider logging all admin actions for compliance
7. **Database Encryption**: Consider encrypting sensitive data at rest

## Vulnerability Reporting

If you discover a security vulnerability, please:
1. Do NOT create a public GitHub issue
2. Contact the development team directly
3. Provide detailed information about the vulnerability
4. Allow time for patching before public disclosure

## Dependency Security

Run regular security audits:

```bash
npm audit
npm audit fix
```

Current known vulnerabilities should be reviewed and addressed.
