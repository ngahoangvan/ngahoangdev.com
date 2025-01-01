---
title: How I built this website? - Jekyll and AWS (Part 3)
author: nga
date: 2024-04-21 10:00:00 +0700
categories: [Technical sharing, AWS]
tags: [aws, jekyll, cloudfront, s3, route53]
render_with_liquid: false
image:
  path: /assets/img/posts/how-i-built-this-website/jekyll-chirpy-icon.png
  alt: Jekyll and AWS
---

In [previous article](/posts/how-i-built-this-website-part-2), I have shared how to use Github and Github Action for automation build and deploy to AWS. We need the final step to avoid the issue `NoSuchKey` which is returned from S3

## Root cause
CloudFront does allow you to specify a default root object (index.html), but it only works on the root of the website (such as http://www.example.com > http://www.example.com/index.html). It does not work on any subdirectory (such as http://www.example.com/about/). If you were to attempt to request this URL through CloudFront, CloudFront would do a S3 GetObject API call against a key that does not exist.

We have two solutions: `Lambda@Edge` and `CloudFront Function`. In this series, I will use `CloudFront Function` to solve that problem because that is quite easy.

## Overview of solution
CloudFront Functions is a serverless compute capability that allows you to run lightweight functions at the edge of the AWS CloudFront network. These functions execute within AWS's global network of edge locations, enabling you to customize and enhance your content delivery. CloudFront Functions can intercept requests and responses flowing through the CloudFront network, allowing you to modify headers, generate dynamic content, implement security measures, and more...

![Output](/assets/img/posts/how-i-built-this-website/CF-Functions-Behavior-web-1.png)
_Architecture diagram_

## Creating CloudFront Function
Go to the CloudFront service and navigate to "Functions". Then click `Create Function`

![Output](/assets/img/posts/how-i-built-this-website/create-cloudfront-function.png)
_CloudFront Function_

I’ll give the function a name, such as `RewriteDefaultIndexRequest`.
Copy bellow code into the functions. 

```js
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Check whether the URI is missing a file name.
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    
    // Check whether the URI is missing a file extension.
    else if (!uri.includes('.')){
        request.uri += 'index.html';
    }
    
    return request;
}
```

The sample code does two things:
1. If the requested URI ends in a `/` (such as example.com/about/), then it will append ‘index.html’ as a default index file to the request.
2. If the requested URI is missing a file extension (such as example.com/about), then it will append ‘/index.html’ to the request.

After saving the changes to the new CloudFront Function, publish the function by selecting the Publish tab above, and then publish the function. Once done, associate it with the distribution by selecting the “Add association” button that appears in the following image after publishing the function

![Output](/assets/img/posts/how-i-built-this-website/publish-cloudfront-function.png)
_Publish CloudFront Function_

![Output](/assets/img/posts/how-i-built-this-website/associate-cloudfront-function.png)
_Associate CloudFront Function_

Associating a CloudFront Function to a distribution will require CloudFront to perform a deployment, which can take a few minutes. Monitor the status of the deployment to make sure that it has completed before testing.

## Testing
Once the deployment has completed, validate that the function is rewriting the URL by requesting the path `https://your-jekyll-blog.com/about/` or whatever path in your site. If successful, then you should expect the distribution to return the index.html file that is in the about/ sub-folder of your S3 origin

## Conclutsion

This is last part of series `How I built this website`. I hope that you can deploy Jekyll website using S3, CloudFront and Github Action successfully. Again, if you have any concerns in this guilde, feel free to ask me. Your comments are my motivation. Many thanks!!!

## References
Here are a couple other articles that were helpful in getting this setup:
- [Implementing Default Directory Indexes in Amazon S3-backed Amazon CloudFront Origins Using CloudFront Functions](https://aws.amazon.com/blogs/networking-and-content-delivery/implementing-default-directory-indexes-in-amazon-s3-backed-amazon-cloudfront-origins-using-cloudfront-functions/)
