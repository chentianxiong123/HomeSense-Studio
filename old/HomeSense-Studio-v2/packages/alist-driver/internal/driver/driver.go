package driver

import (
	"context"
	"homesense/alist-driver/internal/runtime"
	"io"
)

type Driver interface {
	List(ctx context.Context, mount runtime.MountConfig, rel string) ([]runtime.Entry, error)
	Get(ctx context.Context, mount runtime.MountConfig, rel string) (runtime.Detail, error)
	Open(ctx context.Context, mount runtime.MountConfig, rel string) (io.ReadCloser, error)
	Put(ctx context.Context, mount runtime.MountConfig, dstRel string, name string, reader io.Reader) error
	Remove(ctx context.Context, mount runtime.MountConfig, rel string) error
	Copy(ctx context.Context, mount runtime.MountConfig, srcRel string, dstRel string) error
}

type Registry struct {
	drivers map[string]Driver
}

func NewRegistry() *Registry {
	return &Registry{drivers: map[string]Driver{}}
}

func (r *Registry) Register(name string, driver Driver) {
	r.drivers[name] = driver
}

func (r *Registry) Get(name string) (Driver, bool) {
	driver, ok := r.drivers[name]
	return driver, ok
}

func (r *Registry) Names() []string {
	names := make([]string, 0, len(r.drivers))
	for name := range r.drivers {
		names = append(names, name)
	}
	return names
}
