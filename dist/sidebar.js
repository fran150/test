
define('text!qk-alchemy/components/layout/sidebar.component.html',[],function () { return '<quark-component>\r\n    <div class="sidebar" data-bind="onBind: init,\r\n                                    css: classes,\r\n                                    style: styles">\r\n        <span data-bind="css: resizerClass">\r\n            <button class="resizer" data-bind="onBind: initResizer,\r\n                              style: resizerStyle">\r\n               <span class="glyphicon glyphicon-option-vertical"></span>\r\n            </button>\r\n        </span>\r\n\r\n        <ul data-bind="style: { marginTop: model.marginTop }">\r\n            <!-- ko content -->\r\n            <!-- /ko -->\r\n        </ul>\r\n    </div>\r\n</quark-component>\r\n';});

define('qk-alchemy/lib/utils',[
    'quark',
    'knockout'
], function($$, ko) {
    function Utils() {
        var self = this;

        this.findContainer = function(context, type) {
            // Get the context container
            var container = context.$container;

            var found = false;

            if ($$.isArray(type)) {
                for (var i = 0; i < type.length; i++) {
                    var actualType = type[i];

                    if (container instanceof actualType) {
                        found = true;
                        break;
                    }
                }
            } else {
                found = (container instanceof type);
            }

            // If the container exists and is of the requested type return it
            if (found) {
                return container;
            } else {
                // If there's a parent context search for the container type on it
                var parentContext = context.$parentContext;

                if (parentContext) {
                    return self.findContainer(parentContext, type);
                }
            }
        }
    }

    return new Utils();
});

define('text!qk-alchemy/components/layout.component.html',[],function () { return '<!-- quark-component -->\r\n    <!-- ko content -->\r\n    <!-- /ko -->\r\n<!-- /ko -->\r\n';});

/**
    @component
    Allows to define the general layout of the page. It coordinates the navbar,
    sidebar and main container and interactions between them.
    <br/>
    For example, this is a layout with a navbar and sidebar
    &lt;quark-component&lt;
        &lt;al-layout&lt;
            &lt;al-layout-sidebar&lt;
            &lt;/al-layout-sidebar&lt;

            &lt;al-layout-container&lt;
            &lt;/al-layout-container&lt;
        &lt;/al-layout&lt;
    &lt;/quark-component&lt;
    @allowContent
*/
define('qk-alchemy/components/layout.component',[
    'quark',
    'knockout',
    'text!./layout.component.html'
], function($$, ko, template) {

    function LayoutComponent(params, $scope, $imports) {
        var self = this;

        /**
            @property bool True if the layout contains a al-layout-navbar component.
            Do not set this property by code.
            @observable
        */
        this.hasNavbar = ko.observable(false);
        /**
            @property bool True if the layout has a al-layout-sidebar component.
            Do not set this property by code.
            @observable
        */
        this.hasSidebar = ko.observable(false);
        /**
            @property bool True if the layout has a al-layout-submenu component.
            Do not set this property by code.
            @observable
        */
        this.hasSubmenu = ko.observable(false);

        $$.parameters({
            /**
                @parameter int sidebar's width in pixels, sidebar's max size is
                half the window
                @observable @exposed
            */
            sidebarSize: ko.observable(90),
            /**
                @parameter string Bootstrap size with the breaking point of the main container.
                When the viewport is less than this size the sidebar breaks above
                the main content.
                @observable @exposed
            */
            containerSize: ko.observable('md'),
            /**
                @parameter int Minimal width of the sidebar in pixels
                @observable @exposed
            */
            minSidebarSize: ko.observable(20),
            /**
                @parameter bool True if the container is fluid
                @observable @exposed
            */
            containerFluid: ko.observable(true)
        }, params, this);

        // On component init
        $imports.initComponent = function() {
            // Validate sidebar size and apply body margin
            validateSize(self.sidebarSize());
            setBodyMargin(self.hasNavbar());
        }

        // Limit sidebar size
        function validateSize() {
            var size = self.sidebarSize();
            var minSize = self.minSidebarSize();
            var maxSize = $(window).width() / 2;

            if ($$.isNumeric(minSize) && minSize > 0 && size < minSize) {
                self.sidebarSize(minSize);
            }

            if (size < 0) {
                self.sidebarSize(0);
            }

            if (size > maxSize) {
                self.sidebarSize(maxSize);
            }
        }

        // Applies the body margin if it has a navbar
        function setBodyMargin(hasNavbar) {
            if (hasNavbar) {
                $(document).css('padding-top', '50px');
            } else {
                $(document).css('padding-top', 'auto');
            }
        }

        var subscriptions = {
            // Validate sidebar size on size change
            sidebarSize: self.sidebarSize.subscribe(validateSize),
            // Validate sidebar size on min size change
            minSidebarSize: self.minSidebarSize.subscribe(validateSize),
            // Apply body margin when hasNavbar changes
            hasNavbar: self.hasNavbar.subscribe(setBodyMargin)
        };

        // Cleans component on dispose
        $scope.dispose = function() {
            subscriptions.sidebarSize.dispose();
            subscriptions.minSidebarSize.dispose();
            subscriptions.hasNavbar.dispose();
        }
    }

    return $$.component(LayoutComponent, template)
})
;
/**
    @component Defines the sidebar of the page. It must be used inside a al-layout
    component. This component allows to define the elements that shows on the page's
    sidebar. The sidebar is resizeable and the elements readapt to the sidebar's size.
    For example: <br/>
    <code-highlight params="language: 'html'">
        &lt;al-layout&gt;
            &lt;al-layout-sidebar&gt;
                <al-layout-sidebar-link params="text: 'Example menu'">
                </al-layout-sidebar-link>
            &lt;/al-layout-navbar&gt;
        &lt;/al-layout&gt;
    </code-highlight>
    @allowContent
*/
define('qk-alchemy/components/layout/sidebar.component',[
    'knockout',
    'quark',
    'text!./sidebar.component.html',
    '../../lib/utils',
    '../layout.component'
], function(ko, $$, template, utils, LayoutComponent) {

    function LayoutSidebarComponent(params, $scope, $imports) {
        var self = this;

        // Indicates if the layout has a navbar
        var hasNavbar;
        // Indicates if the layout has a sidebar
        var hasSidebar;

        // Container bootstrap's size (when breaks to the top of page)
        var containerSize = ko.observable();

        /**
            @property bool Indicates if the sidebar is resizing
            @observable
        */
        this.resizing = ko.observable(false);

        // This component local parameters
        $$.parameters({
            /**
                @parameter int Width in pixels of the resizer element
                @observable @exposed
            */
            resizerWidth: ko.observable(10),
            /**
                @parameter int Margin to the first element in the sidebar
                @observable @exposed
            */
            marginTop: ko.observable(0)
        }, params, this);

        // Main div DOM element
        var sidebarElement;
        // Resizer DOM element
        var resizerElement;
        // Offset of click in the resizer button
        var offset;

        // Layout variable values that can be overriden by local parameters
        var layout = {
            // Stores the sidebar size observable of the layout component
            sidebarSize: ko.observable(),
            // Min sidebar's size
            minSidebarSize: ko.observable()
        }

        // Set's the sidebar top if the layout has a navbar or not
        function setSidebarTop(hasNavbar) {
            if (hasNavbar) {
                $(sidebarElement).css('top', '50px');
            } else {
                $(sidebarElement).css('top', '0px');
            }
        }

        // Show the resizer bar if mouse is in the correct position
        function showResizerBar(event) {
            // If the mouse is on the edge of the div show the resizer bar
            if (event.pageX > (layout.sidebarSize() - self.resizerWidth())) {
                $(resizerElement).show();
            } else {
                $(resizerElement).hide();
            }
        }

        // Hide the resizer bar if not resizing
        function hideResizerBar() {
            if (!self.resizing()) {
                $(resizerElement).hide();
            }
        }

        // Start resizing the sidebar
        function startResizing(event) {
            // On mouse down start resizing and set initial size
            offset = event.offsetX;
            self.resizing(true);
            layout.sidebarSize(event.pageX + (self.resizerWidth() - offset));
        }

        // Stop resizing the sidebar
        function stopResizing(event) {
            self.resizing(false);
        }

        // Change the sidebar size
        function resizeSidebar(event) {
            if (self.resizing()) {
                layout.sidebarSize(event.pageX + (self.resizerWidth() - offset));
            }
        }

        // Observable subscriptions
        var subscriptions = {
            // Subscribe to the resizing flag
            resizing: self.resizing.subscribe(function(newValue) {
                // If its resizing attach events to the window to do the actual resizing and listen
                // if it has to stop resizing, otherwise detach those events
                if (newValue) {
                    $(window).on('mousemove', resizeSidebar);
                    $(window).on('mouseup', stopResizing);
                } else {
                    $(window).off('mousemove', resizeSidebar);
                    $(window).off('mouseup', stopResizing);
                }
            })
        }


        // When binding the main div
        $scope.init = function(element, viewModel, context) {
            // Get the sidebar's DOM element
            sidebarElement = element;

            // Get the main layout component
            var layoutMain = utils.findContainer(context, LayoutComponent.modelType);;

            // If a layout component is found
            if (layoutMain) {
                // Extract layout variables
                layout.sidebarSize = layoutMain.sidebarSize;
                layout.minSidebarSize = layoutMain.minSidebarSize;
                hasNavbar = layoutMain.hasNavbar;
                hasSidebar = layoutMain.hasSidebar;
                containerSize = layoutMain.containerSize;

                // Apply local parameter value to layout variables
                $$.inject(params, layout);

                // Set the has sidebar variable to true on the main layout
                layoutMain.hasSidebar(true);

                // Publish properties of the layout as local properties of this model
                self.sidebarSize = layoutMain.sidebarSize;
                self.minSidebarSize = layoutMain.minSidebarSize;

                // Subscribe to has navbar change
                subscriptions.hasNavbar = hasNavbar.subscribe(function(newValue) {
                    // When the hasNavbar observable changes, move the top value of the sidebar
                    // to make room for it
                    setSidebarTop(newValue);
                });

            } else {
                throw new Error('The sidebar component must be used inside an al-layout component');

            }

            // When mouse move in main div check if the resizer bar must be
            // shown
            $(sidebarElement).on('mousemove', showResizerBar);

            // When mouse is leaving the main div and we are not resizing
            // hide the resizer bar
            $(sidebarElement).on('mouseleave', hideResizerBar);

            // Sets the sidebar top checking if it has navbar or not
            setSidebarTop(hasNavbar())
        }

        // When the resizer inits
        $scope.initResizer = function(element) {
            // Get the resizer DOM element
            resizerElement = element;
            // Attach mouse down event to resizer element for resizing start
            $(resizerElement).on('mousedown', startResizing);
        }

        // Sidebar's width
        this.width = ko.pureComputed(function() {
            return layout.sidebarSize() + "px";
        });

        $scope.styles = ko.pureComputed(function() {
            var style = {
                width: layout.sidebarSize() + "px"
            };

            return style;
        });

        // Sidebar's classes
        $scope.classes = ko.pureComputed(function() {
            return "sidebar-col-" + containerSize();
        });

        // Classes to apply to the resizer element
        $scope.resizerClass = ko.pureComputed(function() {
            return "resizer-" + containerSize();
        });

        // Element styles to apply to the resizer button
        $scope.resizerStyle = ko.pureComputed(function() {
            var width = self.resizerWidth();
            var style = { fontSize: width };

            style.left = (self.sidebarSize() - width) + "px";

            return style;
        })

        // Dispose the component
        $scope.dispose = function() {
            // Alert the layout component that it has no more sidebar
            hasSidebar(false);

            // Dispose subscriptions
            subscriptions.resizing.dispose();
            subscriptions.hasNavbar.dispose();

            // Delete events
            $(resizerElement).off('mousedown', startResizing);
            $(sidebarElement).off('mousemove', showResizerBar);
            $(sidebarElement).off('mouseleave', hideResizerBar);
            $(window).off('mousemove', resizeSidebar);
            $(window).off('mouseup', stopResizing);

        }
    }

    return $$.component(LayoutSidebarComponent, template);
});

define('text!qk-alchemy/components/layout/sidebar/imagebutton.component.html',[],function () { return '<quark-component>\r\n    <li class="text-center imagebutton" data-bind="onBind: init,\r\n                                                   click: click">\r\n        <a data-bind="click: click, attr: { href: url }">\r\n            <!-- ko if: model.icon -->\r\n                <div data-bind="css: model.icon"></div><br />\r\n            <!-- /ko -->\r\n            <small class="sidebar-text" data-bind="text: model.text,\r\n                                                   css: { notext: hideText }">\r\n            </small>\r\n        </a>\r\n    </li>\r\n</quark-component>\r\n';});

/**
    @component Shows a button on the sidebar. It must be used inside an al-layout-sidebar
    component as virtual.
*/
define('qk-alchemy/components/layout/sidebar/imagebutton.component',[
    'knockout',
    'quark',
    'text!./imagebutton.component.html',
    '../../../lib/utils',
    '../sidebar.component'
], function(ko, $$, template, utils, Sidebar) {

    function LayoutSidebarImageButtonComponent(params, $scope) {
        var self = this;

        // Component's parameters
        $$.parameters({
            /**
                @parameter string Name of the route to redirect when clicking on the button
                @observable @exposed
            */
            pageName: ko.observable(),
            /**
                @parameter string Page parameters
                @observable @exposed
            */
            pageParams: ko.observable(),
            /**
                @parameter string Font icon class to show
                @observable @exposed
            */
            icon: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter string Text to show
                @observable @exposed
            */
            text: ko.observable('Button'),
            /**
                @parameter int Hide button text when sidebar width is less than this size in pixels
                @observable @exposed
            */
            hideTextAt: ko.observable(85)
        }, params, this);

        // Store sidebarSize observable from the sidebar component
        var sidebarSize = ko.observable();

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, Sidebar.modelType);

            // Check if its a Sidebar component
            if (container) {
                // Get the sidebar size observable
                if (container.sidebarSize) {
                    sidebarSize = container.sidebarSize;
                }
            } else {
                throw new Error('This component must be used inside an al-layout-sidebar component');
            }
        }

        // Applies an style that hides the button text when size is narrower
        // than this
        $scope.hideText = ko.pureComputed(function() {
            if (sidebarSize() < self.hideTextAt()) {
                return true;
            }

            return false;
        });


        // When the user clicks on the div redirect to the url
        $scope.click = function() {
            var link = $scope.url();
            if (link) {
                $$.redirect(link);
            }
        }

        // Creates the url with the given route name and config
        $scope.url = ko.pureComputed(function() {
            var pageName = self.pageName();
            var pageParams = self.pageParams();

            if (pageName) {
                return '#' + $$.routing.hash(pageName, pageParams);
            } else {
                return "";
            }
        });
    }

    return $$.component(LayoutSidebarImageButtonComponent, template);
});

define('text!qk-alchemy/components/layout/sidebar/link.component.html',[],function () { return '<quark-component>\r\n    <li data-bind="onBind: init">\r\n        <ul>\r\n            <!-- ko hasContent: \'submenu\', virtual: true -->\r\n                <li class="option" style="position: relative" data-bind="click: model.toggle">\r\n                    <small style="position: absolute" class="glyphicon" data-bind="css: arrow">\r\n                    </small>\r\n\r\n                    <span class="line">\r\n                        <!-- ko if: model.iconFont -->\r\n                            <span data-bind="css: model.iconFont"></span>\r\n                        <!-- /ko -->\r\n\r\n                        <a href="#">\r\n                            <small data-bind="text: model.text"></small>\r\n                        </a>\r\n                    </span>\r\n                </li>\r\n                <!-- ko if: model.opened -->\r\n                    <li style="position: relative">\r\n                        <!-- ko content: \'submenu\', virtual: true -->\r\n                        <!-- /ko -->\r\n                    </li>\r\n                <!-- /ko -->\r\n            <!-- /ko -->\r\n\r\n            <!-- ko hasNotContent: \'submenu\', virtual: true -->\r\n                <li data-bind="click: click" class="option">\r\n                    <span class="line">\r\n                        <!-- ko if: model.iconFont -->\r\n                            <span data-bind="css: model.iconFont"></span>\r\n                        <!-- /ko -->\r\n                        <a href="#" data-bind="click: click, attr: { href: url }">\r\n                            <small data-bind="text: model.text"></small>\r\n                        </a>\r\n                    </span>\r\n                </li>\r\n            <!-- /ko -->\r\n        </ul>\r\n    </li>\r\n</quark-component>\r\n';});

/**
    @component <p>Shows a link on the sidebar. It must be used inside an al-layout-sidebar
    component as virtual.
    You can specify submenu by nesting this elements inside a virtual tag</p>
    lt;al-layout-sidebar-link&gt;
        lt;!-- submenu --&gt;
            lt;al-layout-sidebar-link virtual&gt;
            lt;/al-layout-sidebar-link&gt;
        lt;!-- /submenu --&gt;
    lt;/al-layout-sidebar-link&gt;
    @allowContent
*/
define('qk-alchemy/components/layout/sidebar/link.component',[
    'knockout',
    'quark',
    'text!./link.component.html',
    '../../../lib/utils',
    '../sidebar.component'
], function(ko, $$, template, utils, Sidebar) {

    function LayoutSidebarLinkComponent(params, $scope) {
        var self = this;

        // Component's parameters
        $$.parameters({
            /**
                @parameter string Class of the icon font to show on the element
                @observable @exposed
            */
            iconFont: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter string Text to show
                @observable @exposed
            */
            text: ko.observable('Menu Option'),
            /**
                @parameter string Page to link when the user clicks on the element
                @observable @exposed
            */
            pageName: ko.observable(),
            /**
                @parameter string Page parameters
                @observable @exposed
            */
            pageParams: ko.observable(),
            /**
                @parameter bool If the link has submenus returns if the dropdown is opened
                showing the child elements
            */
            opened: ko.observable(false)
        }, params, this);

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, [Sidebar.modelType, LayoutSidebarLinkComponent]);

            // Check if its a Sidebar component or a sidebar link
            if (!container) {
                throw new Error('This component must be used inside an al-layout-sidebar or an al-layout-sidebar-link component');
            }
        }

        // Glyphicon of the arrow to show if the component is opened or not
        $scope.arrow = ko.pureComputed(function() {
           return self.opened() ? "glyphicon-menu-down" : "glyphicon-menu-right";
        }, $scope);

        // Toggles the menu state
        this.toggle = function() {
            self.opened(!self.opened());

            $scope.click();
        };

        // The the user clicks on the div redirect to the url
        $scope.click = function() {
            var link = $scope.url();

            if (link) {
                $$.redirect(link);
            }
        }

        // Returns the url given the route name and parameters
        $scope.url = ko.pureComputed(function() {
            var pageName = self.pageName();
            var pageParams = self.pageParams();

            if (pageName) {
                return '#' + $$.routing.hash(pageName, pageParams);
            } else {
                return "";
            }
        });
    }

    return $$.component(LayoutSidebarLinkComponent, template);
});

define('text!qk-alchemy/components/layout/sidebar/search.component.html',[],function () { return '<quark-component>\r\n    <li>\r\n        <form data-bind="submit: search">\r\n            <div class="input-group">\r\n                <input type="text" class="form-control" data-bind="value: model.value,\r\n                                                                   attr: { placeholder: model.placeholder }">\r\n                <span class="input-group-btn">\r\n                    <button class="btn btn-default searchbutton" type="submit" data-bind="css: btnClass">\r\n                        &nbsp;<span class="glyphicon glyphicon-search"></span>\r\n                    </button>\r\n                </span>\r\n            </div>\r\n        </form>\r\n    </li>\r\n</quark-component>\r\n';});

/**
    @component Show a textbox and a search button on the sidebar menu. It must be
    used inside an al-layout-sidebar component.
*/
define('qk-alchemy/components/layout/sidebar/search.component',[
    'knockout',
    'quark',
    'text!./search.component.html',
    '../../../lib/utils',
    '../sidebar.component'
], function(ko, $$, template, utils, Sidebar) {

    function LayoutSidebarSearchComponent(params, $scope) {
        var self = this;

        // Component's parameters
        $$.parameters({
            /**
                @parameter string Value of the textbox
                @observable @exposed
            */
            value: ko.observable(''),
            /**
                @parameter string Placeholder of the textbox
                @observable @exposed
            */
            placeholder: ko.observable('Search...'),
            /**
                @parameter string Bootstrap style of the button
                @observable @exposed
            */
            style: ko.observable('default'),
            /**
                @parameter callback Called when the user clicks on the button
                @exposed
            */
            onSearch: function(texto) {}
        }, params, this);

        // On form submit call search event
        $scope.search = function() {
            $$.call(self.onSearch, self.value());
        };

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, Sidebar.modelType);

            // Check if its a Sidebar component
            if (!container) {
                throw new Error('This component must be used inside an al-layout-sidebar component');
            }
        }

        // Button's bootstrap class
        $scope.btnClass = ko.pureComputed(function() {
            var style = self.style();

            switch (style) {
                case 'danger':
                case 'warning':
                case 'success':
                case 'primary':
                    return "btn-" + style;
                    break;
                default:
                    return "btn-default";
            }
        }, $scope);
    }

    return $$.component(LayoutSidebarSearchComponent, template);
});

define('text!qk-alchemy/components/layout/sidebar/title.component.html',[],function () { return '<quark-component>\r\n    <li data-bind="onBind: init">\r\n        <h5 class="line text-primary" data-bind="text: model.text"></h5>\r\n    </li>\r\n</quark-component>\r\n';});

/**
    @component Shows a title on the sidebar. It must be used inside an
    al-layout-sidebar component.
*/
define('qk-alchemy/components/layout/sidebar/title.component',[
    'knockout',
    'quark',
    'text!./title.component.html',
    '../../../lib/utils',
    '../sidebar.component'
], function(ko, $$, template, utils, Sidebar) {

    function LayoutSidebarTitleComponent(params, $scope) {
        var self = this;

        // Component's parameters
        $$.parameters({
            /**
                @parameter string Font icon class to show
                @observable @exposed
            */
            iconFont: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter string Title text
                @observable @exposed
            */
            text: ko.observable('Menu Title')
        }, params, this);

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, Sidebar.modelType);

            // Check if its a Sidebar component
            if (!container) {
                throw new Error('This component must be used inside an al-sidebar component');
            }
        }
    }

    return $$.component(LayoutSidebarTitleComponent, template);
});
