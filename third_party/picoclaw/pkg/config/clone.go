package config

import (
	"reflect"
)

var (
	secureStringType   = reflect.TypeOf(SecureString{})
	secureStringPtr    = reflect.TypeOf(&SecureString{})
	secureStringsSlice = reflect.TypeOf(SecureStrings(nil))
)

// Clone returns a deep copy of the configuration. Credential fields
// (SecureString / SecureStrings) are reconstructed from their resolved values,
// so a Clone must never be JSON round-tripped first (SecureStrings marshal to
// "[NOT_HERE]" and would be lost).
//
// The copy is fully independent: mutating the returned Config's agents, tools,
// model list, MCP servers, channels or hooks never affects the source, which is
// what makes per-tenant overrides safe under concurrency.
func (c *Config) Clone() *Config {
	if c == nil {
		return nil
	}
	out := deepCloneValue(reflect.ValueOf(c))
	return out.Interface().(*Config)
}

// deepCloneValue recursively copies any value while preserving credentials and
// skipping unexported state that is either lazily rebuilt (sensitiveCache) or
// irrelevant (isVirtual). It never shares slices, maps, or pointers with the
// source.
func deepCloneValue(v reflect.Value) reflect.Value {
	if !v.IsValid() {
		return v
	}
	t := v.Type()

	// Preserve credential values: their interesting state lives in unexported
	// fields that a plain reflective struct copy would drop.
	switch t {
	case secureStringType:
		s := v.Interface().(SecureString)
		return reflect.ValueOf(*NewSecureString(s.String()))
	case secureStringPtr:
		if v.IsNil() {
			return reflect.Zero(t)
		}
		p := v.Interface().(*SecureString)
		return reflect.ValueOf(NewSecureString(p.String()))
	case secureStringsSlice:
		ss := v.Interface().(SecureStrings)
		if ss == nil {
			return reflect.Zero(t)
		}
		vals := ss.Values()
		return reflect.ValueOf(SimpleSecureStrings(vals...))
	}

	switch v.Kind() {
	case reflect.Ptr:
		if v.IsNil() {
			return reflect.Zero(t)
		}
		out := reflect.New(t.Elem())
		out.Elem().Set(deepCloneValue(v.Elem()))
		return out

	case reflect.Interface:
		if v.IsNil() {
			return reflect.Zero(t)
		}
		elem := deepCloneValue(v.Elem())
		out := reflect.New(elem.Type()).Elem()
		out.Set(elem)
		return out

	case reflect.Struct:
		out := reflect.New(t).Elem()
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if !f.IsExported() {
				continue
			}
			out.Field(i).Set(deepCloneValue(v.Field(i)))
		}
		return out

	case reflect.Slice:
		if v.IsNil() {
			return reflect.Zero(t)
		}
		out := reflect.MakeSlice(t, v.Len(), v.Len())
		for i := 0; i < v.Len(); i++ {
			out.Index(i).Set(deepCloneValue(v.Index(i)))
		}
		return out

	case reflect.Map:
		if v.IsNil() {
			return reflect.Zero(t)
		}
		out := reflect.MakeMapWithSize(t, v.Len())
		iter := v.MapRange()
		for iter.Next() {
			out.SetMapIndex(deepCloneValue(iter.Key()), deepCloneValue(iter.Value()))
		}
		return out

	case reflect.Array:
		out := reflect.New(t).Elem()
		for i := 0; i < v.Len(); i++ {
			out.Index(i).Set(deepCloneValue(v.Index(i)))
		}
		return out

	default:
		return v
	}
}